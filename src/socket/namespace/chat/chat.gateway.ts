import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { ChatService } from 'src/chat/chat.service';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { BaseGateway } from '../../base/base.gateway';
import type { JwtSocketPayload } from '../../decorators/ws-user.decorator';
import { WsUser } from '../../decorators/ws-user.decorator';
import { SocketRoomService } from '../../socket.service';

/**
 * Chat Gateway
 * - JWT verification is inherited from BaseGateway (connection level)
 * - Uses @WsUser() decorator to get authenticated user
 */
@WebSocketGateway({ cors: true, namespace: '/chat' })
export class ChatGateway extends BaseGateway {

  constructor(
    private readonly chatService: ChatService, 
    socketRoomService: SocketRoomService,
    jwtService: JwtService,
  ) {
    super(socketRoomService, jwtService);
  }

  // ============= Event Handlers =============

  @SubscribeMessage(SocketEventsEnum.CHAT_JOIN_USER)
  async handleJoinUser(
    @ConnectedSocket() client: Socket,
    @WsUser() user: JwtSocketPayload,
  ) {
    const accountId = user.accountId || user.sub;
    await client.join(`user:${accountId}`);
    client.emit(SocketEventsEnum.ROOM_JOINED, { room: `user:${accountId}` });
    console.log(`[Chat Gateway] User ${accountId} joined user room`);
  }

  @SubscribeMessage(SocketEventsEnum.CHAT_LEAVE_USER)
  async handleLeaveUser(
    @ConnectedSocket() client: Socket,
    @WsUser() user: JwtSocketPayload,
  ) {
    const accountId = user.accountId || user.sub;
    await client.leave(`user:${accountId}`);
    console.log(`[Chat Gateway] User ${accountId} left user room`);
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
    @WsUser() user: JwtSocketPayload,
    @MessageBody()
    payload: {
      conversationId: string;
      content: string;
      clientMessageId?: string;
    },
  ) {
    try {
      const senderId = user.accountId || user.sub;
      const senderEmail = user.email;
      
      console.log(`[Chat Gateway] Received message for conversation ${payload.conversationId} from ${senderId}`);
      const saved = await this.chatService.createMessage({
        conversationId: payload.conversationId,
        senderId: senderId!,
        senderEmail: senderEmail,
        content: payload.content,
        clientMessageId: payload.clientMessageId,
      });

      const res: DataResponse = {
        code: ResponseCode.SUCCESS,
        message: 'Message sent',
        data: saved,
      };

      console.log('[Chat Gateway] Stored message, broadcasting to rooms');

      // Broadcast to conversation room
      this.server.to(`conv:${payload.conversationId}`).emit(SocketEventsEnum.CHAT_MESSAGE_RECEIVED, res);

      // Also broadcast to recipient user room(s)
      const conv = await this.chatService.getConversation(payload.conversationId);
      if (conv && conv.participants) {
        conv.participants.forEach((p: any) => {
          if (String(p.accountId) !== String(senderId)) {
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
    @WsUser() user: JwtSocketPayload,
    @MessageBody() payload: { conversationId: string },
  ) {
    const accountId = user.accountId || user.sub;
    await this.chatService.markRead(payload.conversationId, accountId!);
    this.server.to(`conv:${payload.conversationId}`).emit(SocketEventsEnum.CHAT_MESSAGE_READ, {
      conversationId: payload.conversationId,
      accountId,
    });
    console.log(`[Chat Gateway] Messages marked as read in conversation: ${payload.conversationId}`);
  }
}