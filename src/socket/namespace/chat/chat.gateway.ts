import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { CHAT_MESSAGE_REDIS_CHANNEL } from 'src/chat/chat-queue.constants';
import { ChatService } from 'src/chat/chat.service';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { SocketEventsEnum } from 'src/common/enum/socket-events.enum';
import { RedisService } from 'src/common/redis/redis.service';
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
export class ChatGateway extends BaseGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService, 
    private readonly redisService: RedisService,
    socketRoomService: SocketRoomService,
    jwtService: JwtService,
  ) {
    super(socketRoomService, jwtService);
  }

  async onModuleInit(): Promise<void> {
    if (this.chatService.getRealtimeMode() !== 'redis') {
      return;
    }

    await this.redisService.subscribe(CHAT_MESSAGE_REDIS_CHANNEL, async (payload: any) => {
      const message = payload?.message;
      const conversationId = payload?.conversationId;
      const senderId = payload?.senderId;
      if (!message || !conversationId) {
        return;
      }

      const response: DataResponse = {
        code: ResponseCode.SUCCESS,
        message: 'Message sent',
        data: message,
      };

      await this.broadcastMessage(conversationId, response, senderId);
    });

    this.logger.log('Chat gateway subscribed to Redis chat.message channel');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.chatService.getRealtimeMode() === 'redis') {
      await this.redisService.unsubscribe(CHAT_MESSAGE_REDIS_CHANNEL);
    }
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
      const createdAt = new Date().toISOString();

      const queueEvent = {
        conversationId: payload.conversationId,
        senderId: senderId!,
        senderEmail,
        content: payload.content,
        clientMessageId: payload.clientMessageId,
        createdAt,
      };

      if (this.chatService.isWorkerWriteMode()) {
        // Worker-write mode: enqueue and ACK immediately; persistence/realtime are handled asynchronously.
        await this.chatService.publishMessageCreatedEvent(queueEvent);
        client.emit(SocketEventsEnum.CHAT_MESSAGE_DELIVERED, {
          code: ResponseCode.SUCCESS,
          message: 'Message queued',
          data: {
            conversationId: payload.conversationId,
            clientMessageId: payload.clientMessageId,
            createdAt,
          },
        } as DataResponse);
        return;
      }
      
      console.log(`[Chat Gateway] Received message for conversation ${payload.conversationId} from ${senderId}`);
      const saved = await this.chatService.createMessage({
        conversationId: payload.conversationId,
        senderId: senderId!,
        senderEmail: senderEmail,
        content: payload.content,
        clientMessageId: payload.clientMessageId,
      });

      await this.chatService.publishMessageCreatedEvent({
        ...queueEvent,
        messageId: String(saved._id),
      });

      const res: DataResponse = {
        code: ResponseCode.SUCCESS,
        message: 'Message sent',
        data: saved,
      };

      console.log('[Chat Gateway] Stored message, broadcasting to rooms');

      if (this.chatService.getRealtimeMode() === 'direct') {
        await this.broadcastMessage(payload.conversationId, res, senderId);
      } else {
        // In redis realtime mode, gateway consumes from Redis channel and fans out from there.
        await this.chatService.publishRealtimeMessage({
          conversationId: payload.conversationId,
          senderId: senderId!,
          message: saved,
        });
      }
    } catch (e: any) {
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
    await this.chatService.markRead(payload.conversationId, user);
    this.server.to(`conv:${payload.conversationId}`).emit(SocketEventsEnum.CHAT_MESSAGE_READ, {
      conversationId: payload.conversationId,
      accountId,
    });
    console.log(`[Chat Gateway] Messages marked as read in conversation: ${payload.conversationId}`);
  }

  private async broadcastMessage(
    conversationId: string,
    response: DataResponse,
    senderId?: string,
  ): Promise<void> {
    this.server.to(`conv:${conversationId}`).emit(SocketEventsEnum.CHAT_MESSAGE_RECEIVED, response);

    const conv = await this.chatService.getConversation(conversationId);
    if (conv?.participants) {
      conv.participants.forEach((participant: any) => {
        if (senderId && String(participant.accountId) === String(senderId)) {
          return;
        }
        this.server.to(`user:${participant.accountId}`).emit(SocketEventsEnum.CHAT_MESSAGE_RECEIVED, response);
      });
    }
  }
}