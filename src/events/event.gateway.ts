import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';

@WebSocketGateway({ cors: true }) // tạm thời cho cors để tránh lỗi nhãm về resouce, sau có endpoint thì sửa
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  // client sẽ join room theo email hoặc requestId
  @SubscribeMessage('join')
  handleJoin(@ConnectedSocket() client: Socket, payload: { userId: string }) {
    client.join(payload.userId);
    console.log(`Client joined room: ${payload.userId}`);
  }

  @OnEvent('user.register.success')
  handleSuccess(payload: any) {
    const dataRes: DataResponse = {
        code: ResponseCode.SUCCESS,
        message: "User registered sucessfully",
        data: payload.email
    }
    this.server
      .to(payload.dto.email)
      .emit('registerStatus', dataRes);
  }

  @OnEvent('user.register.failed')
  handleFailed(payload: any) {
    const dataRes: DataResponse = {
        code: ResponseCode.ERROR,
        message: "Error when registering user!",
        data: null
    }
    this.server
      .to(payload.dto.email)
      .emit('registerStatus', dataRes);
  }
}
