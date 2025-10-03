import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ChuyenKhoaModule } from 'src/chuyen-khoa/chuyenkhoa.module';
import { AccountModule } from './account/account.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { DoctorModule } from 'src/doctor/doctor.module';
import { PatientModule } from 'src/patient/patient.module';
import { Profile } from 'src/profile/schema/profile.schema';
import { ProfileModule } from 'src/profile/profile.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGO_DB_URI'),
      }),
    }),
    AccountModule,
    ChuyenKhoaModule,
    DoctorModule,
    PatientModule,
    ProfileModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
      consumer.apply(LoggerMiddleware)
      .forRoutes('*');
  }
}
