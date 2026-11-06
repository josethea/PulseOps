import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { seriesQuerySchema, snapshotQuerySchema } from '@pulseops/contracts';
import type { SeriesQuery, SnapshotQuery } from '@pulseops/contracts';

import { RequirePermission } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TelemetryService } from './telemetry.service.js';

// Tenant data is private: never let a shared cache store it.
const PRIVATE_CACHE = 'private, no-store';

@ApiTags('telemetry')
@Controller('organizations/:orgId')
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Get('dashboard/snapshot')
  @RequirePermission('dashboard:read')
  @Header('Cache-Control', PRIVATE_CACHE)
  snapshot(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(snapshotQuerySchema)) query: SnapshotQuery,
  ) {
    return this.telemetry.snapshot(orgId, query);
  }

  @Get('metrics/series')
  @RequirePermission('dashboard:read')
  @Header('Cache-Control', PRIVATE_CACHE)
  series(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(seriesQuerySchema)) query: SeriesQuery,
  ) {
    return this.telemetry.series(orgId, query);
  }

  @Get('services')
  @RequirePermission('dashboard:read')
  @Header('Cache-Control', PRIVATE_CACHE)
  services(@Param('orgId') orgId: string) {
    return this.telemetry.services(orgId);
  }
}
