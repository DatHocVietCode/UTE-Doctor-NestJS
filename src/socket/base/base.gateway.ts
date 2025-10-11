import {
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SocketRoomService } from '../socket.service';

@WebSocketGateway({
  cors: true,
  namespace: '/', // base namespace, hoặc để dynamic tuỳ client
})
export class BaseGateway {
  @WebSocketServer()
  protected server: Server;

  constructor(protected readonly socketRoomService: SocketRoomService) {}

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
