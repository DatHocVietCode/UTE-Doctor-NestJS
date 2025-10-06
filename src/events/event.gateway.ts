import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';

@WebSocketGateway({ cors: true }) // tạm thời cho cors để tránh lỗi nhãm về resouce, sau có endpoint thì sửa
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  // client sẽ join room theo email hoặc requestId
  @SubscribeMessage(SocketEventsEnum.REGISTER_JOIN_ROOM)
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
      .emit(SocketEventsEnum.REGISTER_STATUS, dataRes);
    console.log("[Socket] Push register user to server")
  }

  @OnEvent('user.register.failed')
  handleFailed(payload: any) {
    const dataRes: DataResponse = {
        code: ResponseCode.ERROR,
        message: payload.dataResponse.message,
        data: null
    }
    this.server
      .to(payload.dto.email)
      .emit(SocketEventsEnum.REGISTER_STATUS, dataRes);
  }
}
