import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
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
  handleJoin(@ConnectedSocket() client: Socket, @MessageBody() payload: { userEmail: string }) {
    console.log("Received join event, payload:", payload);
    client.join(payload.userEmail);
    console.log(`Client joined room: ${payload.userEmail}`);
  }

  @OnEvent('user.register.success')
  handleSuccess(payload: any) {
    const dataRes: DataResponse = {
        code: ResponseCode.SUCCESS,
        message: "User registered sucessfully",
        data: payload.email
    }
    this.server
      .to(payload.registerUser.email)
      .emit('registerStatus', dataRes);
    console.log("[Socket] Push register user to server")
  }

  @OnEvent('user.register.failed')
  handleFailed(payload: any) {
    const dataRes: DataResponse = {
        code: ResponseCode.ERROR,
        message: payload.dataRespone.message,
        data: null
    }
    this.server
      .to(payload.dto.email)
      .emit('registerStatus', dataRes);
  }
}
