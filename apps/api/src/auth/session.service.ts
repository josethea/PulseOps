import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthContext } from './auth.types.js';

export const SESSION_COOKIE = 'pulseops_session';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get ttlMs() {
    return this.env.SESSION_TTL_HOURS * 60 * 60 * 1000;
  }

  async create(userId: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
    return { token, expiresAt };
  }

  /** Resolves a cookie token to its user, or null when missing, expired or suspended. */
  async validate(token: string): Promise<AuthContext | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') {
      return null;
    }
    const { user } = session;
    return {
      sessionId: session.id,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    };
  }

  async destroy(token: string) {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
}
