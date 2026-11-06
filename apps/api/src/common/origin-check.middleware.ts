import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense for cookie sessions: browsers always send `Origin` on cross-site unsafe
 * requests, so reject any that does not come from the web app. Requests without an
 * Origin (curl, server-to-server) are not browser-driven CSRF vectors and pass through.
 */
export function originCheck(allowedOrigin: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const origin = req.header('origin');
    if (!SAFE_METHODS.has(req.method) && origin && origin !== allowedOrigin) {
      throw new ForbiddenException('Cross-origin request rejected');
    }
    next();
  };
}
