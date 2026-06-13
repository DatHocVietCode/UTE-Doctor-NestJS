import { Module } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';
import { BaseGateway } from './base/base.gateway';
import { NotificationRedisListener } from './listenners/notification-redis.listenner';
import { SocketAuthMiddleware } from './middleware/socket-auth.middleware';
import { AppointmentBookingGateway } from './namespace/appointment/appointment-book.gateway';
import { AppointmentGateway } from './namespace/appointment/appointment-result.gateway';
import { AuthGateway } from './namespace/auth.gateway';
import { NotificationGateway } from './namespace/notification/notification.gateway';
import { PatientProfileGateway } from './namespace/patient.profile.gateway';
import { VnPayGateway } from './namespace/payment/payment.vnpay.gateway';
import { PresenceService } from './presence.service';
import { SocketRoomService } from './socket.service';

@Module({
  providers: [
    SocketRoomService,
    SocketAuthMiddleware,
    PresenceService,
    BaseGateway,
    AppointmentGateway,
    NotificationGateway,
    AuthGateway,
    PatientProfileGateway,
    AppointmentBookingGateway,
    VnPayGateway,
    NotificationRedisListener,
    RedisService,
  ],
  exports: [SocketRoomService, PresenceService, SocketAuthMiddleware],
})
export class SocketModule {}
