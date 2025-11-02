import {
  SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SocketRoomService } from '../socket.service';
import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';

@WebSocketGateway({
  cors: true,
  namespace: '/', // base namespace, hoặc để dynamic tuỳ client
})
export class BaseGateway {
  @WebSocketServer()
  protected server: Server;

  constructor(protected readonly socketRoomService: SocketRoomService) {}
 
  @SubscribeMessage(SocketEventsEnum.JOIN_ROOM)
    handleJoinRoom(client: Socket, payload: { email: string }) {
      console.log(`[Socket] Client attempting to join room: ${payload.email}`);
      if (!payload?.email) return;
      client.join(payload.email); // client join vào room email của chính mình
      console.log(`[Socket] Client joined room: ${payload.email}`);
  
      client.emit(SocketEventsEnum.ROOM_JOINED, { email: payload.email }); // Xác nhận đã join room
    }
      
  /** Cho client join vào room */
  joinRoom(client: Socket, room: string) {
    this.socketRoomService.joinRoom(client, room);
  }

  emitToRoom(room: string, event: string, data: any) {
    this.server.to(room).emit(event, data);
  }

  emitToAll(event: string, data: any) {
    this.server.emit(event, data);
  }
}
