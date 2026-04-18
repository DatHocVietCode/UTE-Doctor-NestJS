import { Injectable } from "@nestjs/common";
import { Server, Socket } from 'socket.io';

@Injectable()
export class SocketRoomService {
  async joinRoom(client: Socket, room: string) {
    await client.join(room);
    console.log(`[Socket][${client.nsp.name}] ${client.id} joined room ${room}`);
  }

  emitToRoom(server: Server, room: string, event: string, data: any) {
    server.to(room).emit(event, data);
  }
}
