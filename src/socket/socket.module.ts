import { Module } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';
import { BaseGateway } from './base/base.gateway';
import { CoinExpiryReminderSocketListener } from './listenners/coin-expiry-reminder.listenner';
import { AppointmentBookingGateway } from './namespace/appointment/appointment-book.gateway';
import { AppointmentGateway } from './namespace/appointment/appointment-result.gateway';
import { AuthGateway } from './namespace/auth.gateway';
import { PatientProfileGateway } from './namespace/patient.profile.gateway';
import { VnPayGateway } from './namespace/payment/payment.vnpay.gateway';
import { SocketRoomService } from './socket.service';

@Module({
  providers: [
    SocketRoomService,
    BaseGateway,
    AppointmentGateway,
    AuthGateway,
    PatientProfileGateway,
    AppointmentBookingGateway,
    VnPayGateway,
    CoinExpiryReminderSocketListener,
    RedisService,
  ],
  exports: [SocketRoomService],
})
export class SocketModule {}
