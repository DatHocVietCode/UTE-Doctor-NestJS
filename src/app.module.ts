import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { ChuyenKhoaModule } from 'src/chuyen-khoa/chuyenkhoa.module';
import { DoctorModule } from 'src/doctor/doctor.module';
import { PatientModule } from 'src/patient/patient.module';
import { ProfileModule } from 'src/profile/profile.module';
import { AccountModule } from './account/account.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { MailModule } from './mail/mail.module';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { OtpModule } from './utils/otp/otp.module';
import { AppointmentModule } from './appointment/appointment.module';
import { PaymentModule } from './payment/payment.module';
import { SocketModule } from './socket/socket.module';
import { NotificationModule } from './notification/notification.module';
import { Shift } from 'src/shift/schema/shift.schema';
import { ShiftModule } from 'src/shift/shift.module';
import { TimeSlot } from './timeslot/timeslot.schema';
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
    EventEmitterModule.forRoot(),
    AccountModule,
    AuthModule,
    ChuyenKhoaModule,
    DoctorModule,
    PatientModule,
    ProfileModule,
    SocketModule,
    OtpModule,
    MailModule,
    OrchestrationModule,
	  ShiftModule,
    AppointmentModule,
    PaymentModule,
    NotificationModule,
    TimeSlot
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
