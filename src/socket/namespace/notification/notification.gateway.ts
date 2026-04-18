import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WebSocketGateway } from '@nestjs/websockets';
import { BaseGateway } from 'src/socket/base/base.gateway';
import { SocketRoomService } from 'src/socket/socket.service';

@WebSocketGateway({ cors: true, namespace: '/notification' })
@Injectable()
export class NotificationGateway extends BaseGateway {
  constructor(socketRoomService: SocketRoomService, jwtService: JwtService) {
    super(socketRoomService, jwtService);
  }
}
