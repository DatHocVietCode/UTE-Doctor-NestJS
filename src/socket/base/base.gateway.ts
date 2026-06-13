import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { AuthUser } from 'src/common/interfaces/auth-user';
import { PresenceService } from '../presence.service';
import { SocketRoomService } from '../socket.service';

@WebSocketGateway({
  cors: true,
  namespace: '/', // base namespace
})
export class BaseGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(BaseGateway.name);

  @WebSocketServer()
  protected server!: Server;

  constructor(
    protected readonly socketRoomService: SocketRoomService,
    protected readonly presenceService: PresenceService,
  ) {}

  private normalizeRoom(room: string): string {
    const normalized = room?.trim();
    if (!normalized) {
      return '';
    }

    // Email rooms are matched case-insensitively by convention across FE/BE.
    return normalized.includes('@') ? normalized.toLowerCase() : normalized;
  }

  handleConnection(client: Socket) {
    const userId = client.data?.userId as string | undefined;
    this.logger.log(
      `[Socket][Connection] namespace=${client.nsp.name} socketId=${client.id} userId=${userId || 'missing'}`,
    );

    if (!userId) {
      this.logger.warn(
        `[Socket][Connection] Disconnecting unauthenticated socket namespace=${client.nsp.name} socketId=${client.id}`,
      );
      client.disconnect(true);
      return;
    }

    const authUser = (client.data as { authUser?: AuthUser })?.authUser;
    void this.presenceService.addConnection(userId, client.id, {
      email: authUser?.email,
      role: authUser?.role,
    });

    // Auto-join the authenticated user's own email room so realtime delivery does not
    // depend on the client emitting JOIN_ROOM. The room is derived from the JWT email
    // (never from a client-supplied payload), and re-joining a room is idempotent.
    void this.autoJoinEmailRoom(client, authUser?.email);
  }

  /**
   * Join the socket to its own email room using the authenticated identity only.
   * Mirrors the room used by JOIN_ROOM so notification fan-out (emitToRoom(email, ...))
   * reaches the socket even if the client never sends JOIN_ROOM.
   */
  private async autoJoinEmailRoom(
    client: Socket,
    rawEmail?: string,
  ): Promise<void> {
    const email = this.normalizeRoom(rawEmail || '');
    if (!email) {
      this.logger.warn(
        `[Socket][AutoJoin] Skipped: no email in auth payload namespace=${client.nsp.name} socketId=${client.id}`,
      );
      return;
    }

    try {
      await client.join(email);
      this.logger.log(
        `[Socket][AutoJoin] Joined namespace=${client.nsp.name} socketId=${client.id} room=${email}`,
      );
    } catch (error) {
      this.logger.warn(
        `[Socket][AutoJoin] Failed namespace=${client.nsp.name} socketId=${client.id} room=${email} reason=${(error as Error).message}`,
      );
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId as string | undefined;
    this.logger.log(
      `[Socket][Disconnect] namespace=${client.nsp.name} socketId=${client.id} userId=${userId || 'missing'}`,
    );

    if (!userId) {
      return;
    }

    void this.presenceService.removeConnection(userId, client.id);
  }

  /**
   * JOIN_ROOM: Automatically uses email from JWT token.
   * Client no longer needs to send { email } payload.
   */
  @SubscribeMessage(SocketEventsEnum.JOIN_ROOM)
  async handleJoinRoom(client: Socket) {
    const user = client.data?.authUser;
    this.logger.log(
      `[Socket][JOIN_ROOM] Received namespace=${client.nsp.name} socketId=${client.id} hasAuthUser=${Boolean(user)}`,
    );

    const email = this.normalizeRoom(user?.email || '');
    if (!email) {
      this.logger.warn(
        `[Socket][JOIN_ROOM] Missing email in auth payload namespace=${client.nsp.name} socketId=${client.id}`,
      );
      return;
    }

    // Emit the joined ack only after Socket.IO has finished adding the socket to the room.
    await client.join(email);
    this.logger.log(
      `[Socket][JOIN_ROOM] Joined namespace=${client.nsp.name} socketId=${client.id} room=${email}`,
    );
    client.emit(SocketEventsEnum.ROOM_JOINED, { email });
    this.logger.log(
      `[Socket][JOIN_ROOM] ROOM_JOINED emitted namespace=${client.nsp.name} socketId=${client.id} room=${email}`,
    );
  }

  @SubscribeMessage(SocketEventsEnum.HEARTBEAT)
  async handleHeartbeat(client: Socket) {
    const userId = client.data?.userId as string | undefined;
    if (!userId) {
      this.logger.warn(
        `[Socket][HEARTBEAT] Rejected namespace=${client.nsp.name} socketId=${client.id} reason=missing_userId`,
      );
      return;
    }

    this.logger.log(
      `[Socket][HEARTBEAT] Received namespace=${client.nsp.name} socketId=${client.id} userId=${userId}`,
    );

    const authUser = (client.data as { authUser?: AuthUser })?.authUser;
    await this.presenceService.refreshTTL(userId, client.id, client.nsp.name, {
      email: authUser?.email,
      role: authUser?.role,
    });
    client.data.lastHeartbeatAt = Date.now();

    this.logger.log(
      `[Socket][HEARTBEAT] Processed namespace=${client.nsp.name} socketId=${client.id} userId=${userId}`,
    );
  }

  /** Cho client join vào room */
  async joinRoom(client: Socket, room: string) {
    await this.socketRoomService.joinRoom(client, room);
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
