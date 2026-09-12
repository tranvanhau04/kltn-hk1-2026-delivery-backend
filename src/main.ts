import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for web dashboard and mobile app
  app.enableCors({ origin: '*' });

  // Global API prefix
  app.setGlobalPrefix('api');

  await app.listen(3001);
  console.log('🚀 Backend running on http://localhost:3001/api');
}
bootstrap();
