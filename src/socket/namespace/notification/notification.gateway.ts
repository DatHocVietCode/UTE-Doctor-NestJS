import { Injectable } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import { BaseGateway } from 'src/socket/base/base.gateway';
import { PresenceService } from 'src/socket/presence.service';
import { SocketRoomService } from 'src/socket/socket.service';

@WebSocketGateway({ cors: true, namespace: '/notification' })
@Injectable()
export class NotificationGateway extends BaseGateway {
  constructor(socketRoomService: SocketRoomService, presenceService: PresenceService) {
    super(socketRoomService, presenceService);
  }
}
