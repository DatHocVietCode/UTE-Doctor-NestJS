import { Module } from '@nestjs/common';
import { BaseGateway } from './base/base.gateway';
import { AppointmentGateway } from './namespace/appointment.gateway';
import { AuthGateway } from './namespace/auth.gateway';
import { SocketRoomService } from './socket.service';

@Module({
  providers: [SocketRoomService,BaseGateway, AppointmentGateway, AuthGateway],
  exports: [SocketRoomService],
})
export class SocketModule {}
