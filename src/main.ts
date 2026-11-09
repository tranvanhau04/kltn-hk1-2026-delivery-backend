import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './adapters/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Security: HTTP headers protection
  app.use(helmet());

  // Performance: Response payload compression
  app.use(compression());

  // Scalability: Horizontal WebSocket scaling via Redis adapter
  app.useWebSocketAdapter(new RedisIoAdapter(app));

  // Increase payload size limit to 50MB for bulk VRP dispatching
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Ensure upload directory exists
  const uploadDir = path.join(process.cwd(), 'uploads', 'pod');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // Serve static files from uploads directory
  app.useStaticAssets(path.join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  // Enable CORS for web dashboard and mobile app
  app.enableCors({ origin: '*' });

  // Global API prefix
  app.setGlobalPrefix('api');

  // Global validation pipe — enforces class-validator DTOs across all endpoints
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.listen(3001);
  console.log('🚀 Backend running on http://localhost:3001/api');
}
bootstrap().catch(console.error);
