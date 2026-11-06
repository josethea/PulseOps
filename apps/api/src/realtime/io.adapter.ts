import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';

import type { Env } from '../config/env.js';

/** Applies the same CORS policy as the HTTP API, which is only known once the env is loaded. */
export class EnvIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly env: Env,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: Partial<ServerOptions>) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.env.WEB_ORIGIN, credentials: true },
    } as ServerOptions);
  }
}
