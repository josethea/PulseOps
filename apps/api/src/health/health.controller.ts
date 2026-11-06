import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. Must never depend on external services. */
  @Get('live')
  @ApiOkResponse({ description: 'Process is alive' })
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies are reachable. The Redis check lands with the Redis integration. */
  @Get('ready')
  @ApiOkResponse({ description: 'Service is ready to receive traffic' })
  @ApiServiceUnavailableResponse({ description: 'A dependency is unreachable' })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is unreachable');
    }
    return { status: 'ok', checks: { database: 'up' } };
  }
}
