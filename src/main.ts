import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = ['http://localhost:3000', 'https://ute-doctor-fe.vercel.app'];
   app.enableCors({
    origin: allowedOrigins,
    credentials: true, // nếu dùng cookie
  });
  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
