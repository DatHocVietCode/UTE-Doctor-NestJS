import { JwtService } from '@nestjs/jwt';
import { WebSocketGateway } from '@nestjs/websockets';
import { BaseGateway } from '../base/base.gateway';
import { SocketRoomService } from '../socket.service';

@WebSocketGateway({ cors: true, namespace: '/auth' })
export class AuthGateway extends BaseGateway {
    constructor(socketRoomService: SocketRoomService, jwtService: JwtService) {
       super(socketRoomService, jwtService);
    }
}
