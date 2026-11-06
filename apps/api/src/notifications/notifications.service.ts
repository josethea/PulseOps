import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  AppNotification,
  NotificationListQuery,
  NotificationPage,
  NotificationType,
} from '@pulseops/contracts';

import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../realtime/outbox.service.js';

export interface NewNotification {
  type: NotificationType;
  title: string;
  body: string;
  referenceType: string;
  referenceId: string;
}

function toDto(row: Prisma.NotificationGetPayload<object>): AppNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function decodeCursor(raw: string): { at: Date; id: string } {
  try {
    const [at, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as [string, string];
    const date = new Date(at);
    if (typeof id === 'string' && !Number.isNaN(date.getTime())) return { at: date, id };
  } catch {
    // fall through
  }
  throw new UnprocessableEntityException({
    message: 'Validation failed',
    details: { formErrors: [], fieldErrors: { cursor: ['Invalid cursor'] } },
  });
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Stores one notification per recipient and announces each on the tenant stream. The
   * event carries only the recipient and id: the stream is shared by the whole tenant, so
   * the title and body are fetched over HTTP by the recipient (BR-016).
   */
  async notify(
    tx: Prisma.TransactionClient,
    organizationId: string,
    recipientIds: string[],
    input: NewNotification,
  ) {
    for (const userId of new Set(recipientIds)) {
      const row = await tx.notification.create({
        data: { organizationId, userId, ...input },
      });
      await this.outbox.append(tx, {
        organizationId,
        type: 'notification.created',
        entityId: row.id,
        payload: { recipientId: userId, notificationType: input.type },
      });
    }
  }

  async list(
    organizationId: string,
    userId: string,
    query: NotificationListQuery,
  ): Promise<NotificationPage> {
    const mine: Prisma.NotificationWhereInput = { organizationId, userId };
    const filters: Prisma.NotificationWhereInput = {
      ...mine,
      ...(query.unreadOnly && { readAt: null }),
    };
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const where: Prisma.NotificationWhereInput = cursor
      ? {
          AND: [
            filters,
            {
              OR: [
                { createdAt: { lt: cursor.at } },
                { createdAt: cursor.at, id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : filters;

    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      this.prisma.notification.count({ where: { ...mine, readAt: null } }),
    ]);
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    return {
      items: items.map(toDto),
      nextCursor:
        hasMore && last
          ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString(
              'base64url',
            )
          : null,
      unreadCount,
    };
  }

  /** Idempotent: re-reading keeps the original read time. Someone else's id is "not found". */
  async markRead(organizationId: string, userId: string, id: string): Promise<AppNotification> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.notification.findFirst({ where: { id, organizationId, userId } });
      if (!row) throw new NotFoundException('Notification not found');
      if (row.readAt) return toDto(row);
      const updated = await tx.notification.update({ where: { id }, data: { readAt: new Date() } });
      await this.outbox.append(tx, {
        organizationId,
        type: 'notification.read',
        entityId: id,
        payload: { recipientId: userId },
      });
      return toDto(updated);
    });
  }

  async markAllRead(organizationId: string, userId: string): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { organizationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }
}
