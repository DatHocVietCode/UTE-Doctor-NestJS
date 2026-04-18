import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'path';
import { AppModule } from './app.module';
import { SocketAuthMiddleware } from './socket/middleware/socket-auth.middleware';
import { SocketAdapter } from './socket/socket.adapter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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
  await app.listen(port);
  console.log(`Server is running on http://localhost:${port}/api`);
}
bootstrap();
