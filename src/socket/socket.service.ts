import { Injectable } from "@nestjs/common";
import { Server, Socket } from 'socket.io';

@Injectable()
export class SocketRoomService {
  joinRoom(client: Socket, room: string) {
    client.join(room);
    console.log(`[Socket][${client.nsp.name}] ${client.id} joined room ${room}`);
  }

  emitToRoom(server: Server, room: string, event: string, data: any) {
    server.to(room).emit(event, data);
  }
}
