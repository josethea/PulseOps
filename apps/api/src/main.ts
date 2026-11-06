import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { loadEnv } from './config/env.js';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  configureApp(app, env);

  // OpenAPI is only exposed outside production.
  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('PulseOps API')
      .setDescription('Real-time operations command center API')
      .setVersion('1.0')
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }

  await app.listen(env.API_PORT);
}

void bootstrap();
