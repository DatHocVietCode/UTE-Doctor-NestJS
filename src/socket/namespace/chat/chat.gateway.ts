import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from 'src/chat/chat.service';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { BaseGateway } from '../../base/base.gateway';
import { SocketRoomService } from '../../socket.service';

/**
 * Best Practice Chat Gateway
 * - JWT verification ở connection level (afterInit → server.use())
 * - KHÔNG dùng @UseGuards() cho event handlers
 * - Token expired → server reject connection → client auto reconnect với token mới
 */
@WebSocketGateway({ cors: true, namespace: '/chat' })
export class ChatGateway extends BaseGateway implements OnGatewayInit {
  // server inherited from BaseGateway (protected server: Server)

  constructor(
    private readonly chatService: ChatService, 
    socketRoomService: SocketRoomService,
    private readonly jwtService: JwtService,
  ) {
    super(socketRoomService);
  }

  /**
   * Best Practice: Verify JWT ở connection level
   * Token invalid/expired → reject connection ngay
   */
  afterInit(server: Server) {
    server.use(async (socket: Socket, next) => {
      try {
        const tokenFromAuth = (socket.handshake as any)?.auth?.token as string | undefined;
        const headerAuth = socket.handshake.headers?.authorization as string | undefined;
        const token = tokenFromAuth || (headerAuth?.startsWith('Bearer ') ? headerAuth.substring(7) : undefined);
        
        if (!token) {
          console.log('[Chat Gateway] No token provided in connection');
          return next(new UnauthorizedException('Missing auth token'));
        }

        const payload = await this.jwtService.verifyAsync(token, { 
          secret: process.env.JWT_SECRET 
        });
        
        // Attach user to socket data for use in handlers
        (socket.data as any).user = payload;
        console.log('[Chat Gateway] JWT verified for user:', payload.accountId || payload.sub);
        next();
      } catch (e) {
        console.log('[Chat Gateway] JWT verification failed:', e.message);
        return next(new UnauthorizedException('Invalid or expired token'));
      }
    });
  }

  // ============= Event Handlers (Không cần @UseGuards nữa) =============

  @SubscribeMessage(SocketEventsEnum.CHAT_JOIN_USER)
  async handleJoinUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { accountId: string },
  ) {
    await client.join(`user:${payload.accountId}`);
    client.emit(SocketEventsEnum.ROOM_JOINED, { room: `user:${payload.accountId}` });
    console.log(`[Chat Gateway] User ${payload.accountId} joined user room`);
  }

  @SubscribeMessage(SocketEventsEnum.CHAT_LEAVE_USER)
  async handleLeaveUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { accountId: string },
  ) {
    await client.leave(`user:${payload.accountId}`);
    console.log(`[Chat Gateway] User ${payload.accountId} left user room`);
  }

  @SubscribeMessage(SocketEventsEnum.CHAT_JOIN_CONVERSATION)
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    await client.join(`conv:${payload.conversationId}`);
    client.emit(SocketEventsEnum.ROOM_JOINED, { conversationId: payload.conversationId });
    console.log(`[Chat Gateway] Client joined conversation room: conv:${payload.conversationId}`);
  }

  @SubscribeMessage(SocketEventsEnum.CHAT_LEAVE_CONVERSATION)
  async handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    await client.leave(`conv:${payload.conversationId}`);
    console.log(`[Chat Gateway] Client left conversation room: conv:${payload.conversationId}`);
  }

  @SubscribeMessage(SocketEventsEnum.CHAT_MESSAGE_SEND)
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      conversationId: string;
      senderId: string;
      senderEmail?: string;
      content: string;
      clientMessageId?: string;
    },
  ) {
    try {
      console.log(`[Chat Gateway] Received message for conversation ${payload.conversationId} from ${payload.senderId}`);
      const saved = await this.chatService.createMessage({
        conversationId: payload.conversationId,
        senderId: payload.senderId,
        senderEmail: payload.senderEmail,
        content: payload.content,
        clientMessageId: payload.clientMessageId,
      });

      const res: DataResponse = {
        code: ResponseCode.SUCCESS,
        message: 'Message sent',
        data: saved,
      };

      console.log('[Chat Gateway] Stored message, broadcasting to rooms');
      console.log(`[Chat Gateway] Broadcasting to conversation room: conv:${payload.conversationId}`);

      // Broadcast to conversation room (for users already viewing this chat)
      this.server.to(`conv:${payload.conversationId}`).emit(SocketEventsEnum.CHAT_MESSAGE_RECEIVED, res);

      // Also broadcast to recipient user room(s) for users not yet viewing
      // Get conversation to find all other participants
      const conv = await this.chatService.getConversation(payload.conversationId);
      if (conv && conv.participants) {
        conv.participants.forEach((p: any) => {
          if (String(p.accountId) !== String(payload.senderId)) {
            // Send to recipient's user room
            this.server.to(`user:${p.accountId}`).emit(SocketEventsEnum.CHAT_MESSAGE_RECEIVED, res);
          }
        });
      }
    } catch (e) {
      client.emit(SocketEventsEnum.CHAT_MESSAGE_RECEIVED, {
        code: ResponseCode.ERROR,
        message: e?.message || 'Failed to send',
        data: null,
      } as DataResponse);
    }
  }

  @SubscribeMessage(SocketEventsEnum.CHAT_MESSAGE_READ)
  async handleRead(
    @MessageBody() payload: { conversationId: string; accountId: string },
  ) {
    await this.chatService.markRead(payload.conversationId, payload.accountId);
    this.server.to(`conv:${payload.conversationId}`).emit(SocketEventsEnum.CHAT_MESSAGE_READ, payload);
    console.log(`[Chat Gateway] Messages marked as read in conversation: ${payload.conversationId}`);
  }
}