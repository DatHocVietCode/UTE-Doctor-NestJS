import { OnEvent } from '@nestjs/event-emitter';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { BaseGateway } from '../base/base.gateway';
import { SocketRoomService } from '../socket.service';
import { Socket } from 'socket.io';

@WebSocketGateway({ cors: true, namespace: '/auth' })
export class AuthGateway extends BaseGateway {
    constructor(socketRoomService: SocketRoomService) {
       super(socketRoomService);
    }
    // @SubscribeMessage(SocketEventsEnum.REGISTER_JOIN_ROOM)
    // handleJoinRoom(
    //     @ConnectedSocket() client: Socket,
    //     @MessageBody() payload: { userEmail: string },
    // ) {
    //     if (!payload?.userEmail) return;
    //     this.joinRoom(client, payload.userEmail);
    //     console.log(`[Socket][${client.nsp.name}] Connected: ${client.id}`);
    // }
        
    @OnEvent('user.register.success')
    handleRegisterSuccess(payload: any) {
        const res: DataResponse = {
        code: ResponseCode.SUCCESS,
        message: 'User registered successfully',
        data: payload,
        };
        console.log(payload);
        this.emitToRoom(payload.account.email, SocketEventsEnum.REGISTER_STATUS, res);
        console.log('[Socket][Auth] Push REGISTER SUCCESS to', payload.account.email);
    }

    @OnEvent('user.register.failed')
    handleRegisterFailed(payload: any) {
        const res: DataResponse = {
        code: ResponseCode.ERROR,
        message: payload.dataResponse.message,
        data: null,
        };
        this.emitToRoom(payload.dto.email, SocketEventsEnum.REGISTER_STATUS, res);
        console.log('[Socket][Auth] Push REGISTER FAILED to', payload.dto.email);
    }
}
