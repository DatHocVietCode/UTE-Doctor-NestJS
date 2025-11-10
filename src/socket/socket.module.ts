import { Module } from '@nestjs/common';
import { BaseGateway } from './base/base.gateway';
import { AppointmentGateway } from './namespace/appointment/appointment-result.gateway';
import { AuthGateway } from './namespace/auth.gateway';
import { PatientProfileGateway } from './namespace/patient.profile.gateway';
import { SocketRoomService } from './socket.service';
import { AppointmentBookingGateway } from './namespace/appointment/appointment-book.gateway';
import { VnPayGateway } from './namespace/payment/payment.vnpay.gateway';

@Module({
  providers: [SocketRoomService, BaseGateway, 
    AppointmentGateway, AuthGateway, PatientProfileGateway, AppointmentBookingGateway, VnPayGateway],
  exports: [SocketRoomService],
})
export class SocketModule {}
