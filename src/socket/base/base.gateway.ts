import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { SocketRoomService } from '../socket.service';

@WebSocketGateway({
  cors: true,
  namespace: '/', // base namespace
})
export class BaseGateway implements OnGatewayInit {
  @WebSocketServer()
  protected server: Server;

  constructor(
    protected readonly socketRoomService: SocketRoomService,
    protected readonly jwtService: JwtService,
  ) {}

  private normalizeRoom(room: string): string {
    const normalized = room?.trim();
    if (!normalized) {
      return '';
    }

    // Email rooms are matched case-insensitively by convention across FE/BE.
    return normalized.includes('@') ? normalized.toLowerCase() : normalized;
  }

  /**
   * JWT verification at connection level.
   * All namespaces that extend BaseGateway inherit this middleware.
   * Token invalid/expired → reject connection immediately.
   */
  afterInit(server: Server) {
    server.use(async (socket: Socket, next) => {
      try {
        const tokenFromAuth = (socket.handshake as any)?.auth?.token as string | undefined;
        const headerAuth = socket.handshake.headers?.authorization as string | undefined;
        const token = tokenFromAuth || (headerAuth?.startsWith('Bearer ') ? headerAuth.substring(7) : undefined);

        if (!token) {
          console.log(`[Socket] No token provided in connection`);
          return next(new UnauthorizedException('Missing auth token'));
        }

        const payload = await this.jwtService.verifyAsync(token, {
          secret: process.env.JWT_SECRET,
        });

        // Attach user payload to socket data for use in handlers
        (socket.data as any).user = payload;
        console.log(`[Socket] JWT verified for user:`, payload.accountId || payload.sub);
        next();
      } catch (e) {
        console.log(`[Socket] JWT verification failed:`, e.message);
        return next(new UnauthorizedException('Invalid or expired token'));
      }
    });
  }

  /**
   * JOIN_ROOM: Automatically uses email from JWT token.
   * Client no longer needs to send { email } payload.
   */
  @SubscribeMessage(SocketEventsEnum.JOIN_ROOM)
  handleJoinRoom(client: Socket) {
    const user = (client.data as any)?.user;
    const email = this.normalizeRoom(user?.email || '');
    if (!email) {
      console.log('[Socket] No email found in JWT payload');
      return;
    }

    client.join(email);
    console.log(`[Socket] Client joined room: ${email}`);
    client.emit(SocketEventsEnum.ROOM_JOINED, { email });
  }

  /** Cho client join vào room */
  joinRoom(client: Socket, room: string) {
    this.socketRoomService.joinRoom(client, room);
  }

  emitToRoom(room: string, event: string, data: any) {
    const targetRoom = this.normalizeRoom(room);
    if (!targetRoom) {
      return;
    }

    this.server.to(targetRoom).emit(event, data);
  }

  emitToAll(event: string, data: any) {
    this.server.emit(event, data);
  }
}
