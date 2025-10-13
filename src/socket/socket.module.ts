import { Module } from '@nestjs/common';
import { BaseGateway } from './base/base.gateway';
import { AppointmentGateway } from './namespace/appointment/appointment-result.gateway';
import { AuthGateway } from './namespace/auth.gateway';
import { PatientProfileGateway } from './namespace/patient.profile.gateway';
import { SocketRoomService } from './socket.service';

@Module({
  providers: [SocketRoomService, BaseGateway, 
    AppointmentGateway, AuthGateway, PatientProfileGateway],
  exports: [SocketRoomService],
})
export class SocketModule {}
