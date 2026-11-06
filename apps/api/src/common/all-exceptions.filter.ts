import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

import { REQUEST_ID_HEADER } from './request-id.middleware.js';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/** Maps every error to the standard `{ code, message, details?, requestId, timestamp }` body. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = req.header(REQUEST_ID_HEADER);

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Internal server error';
    let details: unknown;
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const { message: bodyMessage, details: bodyDetails } = body as {
          message?: unknown;
          details?: unknown;
        };
        message = Array.isArray(bodyMessage) ? 'Request failed' : String(bodyMessage ?? message);
        details = bodyDetails ?? (Array.isArray(bodyMessage) ? bodyMessage : undefined);
      }
    } else {
      this.logger.error({ requestId, err: exception }, 'Unhandled exception');
    }

    res.status(status).json({
      code: STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'),
      message,
      ...(details !== undefined && { details }),
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
