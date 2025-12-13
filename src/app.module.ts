import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { ChuyenKhoaModule } from 'src/chuyen-khoa/chuyenkhoa.module';
import { DoctorModule } from 'src/doctor/doctor.module';
import { MedicineModule } from 'src/medicine/medicine.module';
import { PatientModule } from 'src/patient/patient.module';
import { PrescriptionModule } from 'src/prescription/prescription.module';
import { ProfileModule } from 'src/profile/profile.module';
import { ReviewModule } from 'src/review/review.module';
import { ShiftModule } from 'src/shift/shift.module';
import { AccountModule } from './account/account.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppointmentModule } from './appointment/appointment.module';
import { AuthModule } from './auth/auth.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { MailModule } from './mail/mail.module';
import { NotificationModule } from './notification/notification.module';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { PaymentModule } from './payment/payment.module';
import { SocketModule } from './socket/socket.module';
import { TimeSlotModule } from './timeslot/timeslot.module';
import { UserContextModule } from './user-context/user-context.module';
import { OtpModule } from './utils/otp/otp.module';
import { News } from 'src/news/schemas/news.schema';
import { NewsModule } from 'src/news/news.module';
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
    TimeSlotModule,
    MedicineModule,
    PrescriptionModule,
    ReviewModule,
    UserContextModule,
    CloudinaryModule,
    NewsModule,
  // ShiftModule was already imported above; avoid duplicate imports which register providers/listeners twice
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
