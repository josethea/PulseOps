import { Inject, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { OnGatewayInit } from '@nestjs/websockets';
import { REALTIME_NAMESPACE, SOCKET_MESSAGES, hasPermission } from '@pulseops/contracts';
import type { ReadyMessage, RealtimeEnvelope, ResyncMessage } from '@pulseops/contracts';
import type { Namespace, Socket } from 'socket.io';

import { SESSION_COOKIE, SessionService } from '../auth/session.service.js';
import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from './outbox.service.js';

/** More than this behind and replaying costs more than refetching the snapshots. */
export const MAX_REPLAY = 500;
const REVALIDATE_MS = 60_000;

interface SocketData {
  userId: string;
  organizationId: string;
  token: string;
}

export const orgRoom = (organizationId: string) => `org:${organizationId}`;

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

/**
 * Socket.IO namespace `/operations` (spec section 11).
 *
 * The tenant room is chosen by the server: the handshake names an organization, but the
 * connection is only accepted if the session's user has an active membership there with
 * read access, so a client cannot subscribe to a tenant it does not belong to.
 */
@WebSocketGateway({ namespace: REALTIME_NAMESPACE })
export class RealtimeGateway implements OnGatewayInit, OnModuleDestroy {
  private readonly log = new Logger(RealtimeGateway.name);
  private timer?: NodeJS.Timeout;

  @WebSocketServer() server!: Namespace;

  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  afterInit(server: Namespace) {
    // Refusals here are final for the client: socket.io does not retry a denied handshake.
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (error: Error) => next(error),
      );
    });
    server.on('connection', (socket) => {
      void this.onConnection(socket).catch((error) => {
        this.log.error('Connection setup failed', error as Error);
        socket.disconnect(true);
      });
    });
    if (this.env.BACKGROUND_WORKERS) {
      this.timer = setInterval(() => void this.revalidate(), REVALIDATE_MS);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Delivers one committed event to everyone subscribed to its tenant. */
  publish(envelope: RealtimeEnvelope) {
    this.server.to(orgRoom(envelope.organizationId)).emit(SOCKET_MESSAGES.event, envelope);
  }

  /** Drops sockets whose session expired or whose access was revoked since they connected. */
  async revalidate() {
    for (const socket of await this.server.fetchSockets()) {
      const data = socket.data as SocketData;
      if (!(await this.stillAllowed(data))) socket.disconnect(true);
    }
  }

  // ------------------------------------------------------------ handshake

  private async authenticate(socket: Socket) {
    const origin = socket.handshake.headers.origin;
    // Browsers always send Origin; a mismatch means a page from another site is connecting.
    if (origin && origin !== this.env.WEB_ORIGIN) throw new Error('forbidden_origin');

    const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
    const auth = token ? await this.sessions.validate(token) : null;
    if (!token || !auth) throw new Error('unauthenticated');

    const requested = (socket.handshake.auth as { organizationId?: unknown }).organizationId;
    if (typeof requested !== 'string' || requested.length === 0) {
      throw new Error('organization_required');
    }
    const data: SocketData = { userId: auth.user.id, organizationId: requested, token };
    if (!(await this.stillAllowed(data))) throw new Error('forbidden');
    socket.data = data;
  }

  private async stillAllowed(data: SocketData) {
    const [auth, membership] = await Promise.all([
      this.sessions.validate(data.token),
      this.prisma.membership.findUnique({
        where: {
          organizationId_userId: { organizationId: data.organizationId, userId: data.userId },
        },
      }),
    ]);
    return (
      auth?.user.id === data.userId &&
      membership?.status === 'ACTIVE' &&
      hasPermission(membership.role, 'dashboard:read')
    );
  }

  // ------------------------------------------------------------ connection and replay

  private async onConnection(socket: Socket) {
    const { organizationId } = socket.data as SocketData;
    const raw = (socket.handshake.auth as { lastSeenSequence?: unknown }).lastSeenSequence;
    const lastSeen = typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null;

    const latest = await this.latestSequence(organizationId);
    let cursor = lastSeen ?? latest;
    let replayed = 0;

    if (lastSeen !== null && lastSeen !== latest) {
      const resync = await this.replayFrom(socket, organizationId, lastSeen, latest);
      if (resync) {
        socket.emit(SOCKET_MESSAGES.resync, resync);
        // The client refetches snapshots and reconnects with the fresh cursor.
        socket.disconnect(true);
        return;
      }
      replayed = Math.max(0, latest - lastSeen);
      cursor = latest;
    }

    // Join after replaying, then fill anything committed in between. A live event may
    // arrive twice; clients ignore sequences they already applied.
    await socket.join(orgRoom(organizationId));
    const after = await this.latestSequence(organizationId);
    if (after > cursor) {
      const resync = await this.replayFrom(socket, organizationId, cursor, after);
      if (resync) {
        socket.emit(SOCKET_MESSAGES.resync, resync);
        socket.disconnect(true);
        return;
      }
      replayed += after - cursor;
      cursor = after;
    }

    const ready: ReadyMessage = { organizationId, cursor, replayed };
    socket.emit(SOCKET_MESSAGES.ready, ready);
  }

  /** Sends events (from, to] to one socket, or says why that is not possible. */
  private async replayFrom(
    socket: Socket,
    organizationId: string,
    from: number,
    to: number,
  ): Promise<ResyncMessage | null> {
    if (from > to) return { reason: 'cursor_ahead', cursor: to };

    const rows = await this.prisma.eventOutbox.findMany({
      where: { organizationId, sequence: { gt: BigInt(from), lte: BigInt(to) } },
      orderBy: { sequence: 'asc' },
      take: MAX_REPLAY + 1,
    });
    if (rows.length > MAX_REPLAY) return { reason: 'replay_too_large', cursor: to };
    // Anything but a gap-free run means retention already removed part of it.
    const complete = rows.length === to - from && Number(rows[0]?.sequence) === from + 1;
    if (!complete) return { reason: 'cursor_expired', cursor: to };

    for (const row of rows) socket.emit(SOCKET_MESSAGES.event, this.outbox.toEnvelope(row));
    return null;
  }

  private async latestSequence(organizationId: string) {
    const counter = await this.prisma.eventSequence.findUnique({ where: { organizationId } });
    return Number(counter?.lastSequence ?? 0n);
  }
}
