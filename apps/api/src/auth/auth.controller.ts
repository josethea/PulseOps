import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { demoLoginRequestSchema, loginRequestSchema } from '@pulseops/contracts';
import type { DemoLoginRequest, LoginRequest } from '@pulseops/contracts';
import type { Request, Response } from 'express';

import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from './decorators.js';
import { DUMMY_HASH, verifyPassword } from './password.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

/** Demo guests sign in as one of these fixed seeded users, one per role. */
const DEMO_USER_EMAIL_PREFIX = {
  ORG_ADMIN: 'admin',
  OPERATOR: 'operator',
  ANALYST: 'analyst',
  VIEWER: 'viewer',
} as const;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });

    // Always run a hash comparison so response time does not reveal which emails exist.
    const valid = await verifyPassword(body.password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user || !user.passwordHash || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is suspended');
    }

    await this.startSession(user.id, res);
    return { user: { id: user.id, email: user.email, displayName: user.displayName } };
  }

  /** Guest access: signs in as the seeded demo user for the requested role. */
  @Public()
  @Post('demo')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async demo(
    @Body(new ZodValidationPipe(demoLoginRequestSchema)) body: DemoLoginRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.env.DEMO_ENABLED) throw new ForbiddenException('Demo access is disabled');

    const email = `${DEMO_USER_EMAIL_PREFIX[body.role]}@${this.env.DEMO_ORG_SLUG}.pulseops.test`;
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('Demo account is not available');
    }

    await this.startSession(user.id, res);
    return { user: { id: user.id, email: user.email, displayName: user.displayName } };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (token) await this.sessions.destroy(token);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  private async startSession(userId: string, res: Response) {
    const { token, expiresAt } = await this.sessions.create(userId);
    res.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), expires: expiresAt });
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.NODE_ENV === 'production',
      path: '/',
    } as const;
  }
}
