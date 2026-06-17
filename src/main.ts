import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import * as path from 'path';
import { AppModule } from './app.module';
import { SocketAuthMiddleware } from './socket/middleware/socket-auth.middleware';
import { SocketAdapter } from './socket/socket.adapter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(json({ limit: '15mb' }));
  app.use(urlencoded({ extended: true, limit: '15mb' }));

  const allowedOrigins = [
    'http://localhost:3000',
    'https://ute-doctor-fe.vercel.app',
  ];
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));

  app.useWebSocketAdapter(new SocketAdapter(app, app.get(SocketAuthMiddleware)));


  app.setGlobalPrefix('api');

  // Serve generated PDFs and other public assets from /public
  app.useStaticAssets(path.join(process.cwd(), 'public'));

  const port = process.env.PORT ?? 3000;
  // Bind all interfaces so the API is reachable from Docker's container network.
  await app.listen(port, '0.0.0.0');
  console.log(`Server is running on http://0.0.0.0:${port}/api`);
}
bootstrap();
