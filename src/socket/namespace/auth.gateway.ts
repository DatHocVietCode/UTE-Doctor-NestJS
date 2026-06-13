import { WebSocketGateway } from '@nestjs/websockets';
import { BaseGateway } from '../base/base.gateway';
import { PresenceService } from '../presence.service';
import { SocketRoomService } from '../socket.service';

@WebSocketGateway({ cors: true, namespace: '/auth' })
export class AuthGateway extends BaseGateway {
    constructor(socketRoomService: SocketRoomService, presenceService: PresenceService) {
       super(socketRoomService, presenceService);
    }
}
