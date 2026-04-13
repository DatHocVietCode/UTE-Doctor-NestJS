import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Account, AccountDocument } from 'src/account/schemas/account.schema';
import { AuthUser } from 'src/common/interfaces/auth-user';
import { RabbitMqService } from 'src/common/rabbitmq/rabbitmq.service';
import { RedisService } from 'src/common/redis/redis.service';
import { Profile, ProfileDocument } from 'src/profile/schema/profile.schema';
import { DateTimeHelper } from 'src/utils/helpers/datetime.helper';
import {
  CHAT_MESSAGE_CREATED_QUEUE,
  CHAT_MESSAGE_REDIS_CHANNEL,
  ChatMessageCreatedEvent,
  ChatRealtimeMode,
  ChatWriteMode,
} from './chat-queue.constants';
import { Conversation, ConversationDocument } from './schemas/conversation.schema';
import { Message, MessageDocument } from './schemas/message.schema';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(Conversation.name) private convModel: Model<ConversationDocument>,
    @InjectModel(Message.name) private msgModel: Model<MessageDocument>,
    @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
    @InjectModel(Profile.name) private profileModel: Model<ProfileDocument>,
    private readonly rabbitMqService: RabbitMqService,
    private readonly redisService: RedisService,
  ) {}

  getWriteMode(): ChatWriteMode {
    const rawMode = (process.env.CHAT_WRITE_MODE || 'dual').toLowerCase();
    return rawMode === 'worker' ? 'worker' : 'dual';
  }

  getRealtimeMode(): ChatRealtimeMode {
    const rawMode = (process.env.CHAT_REALTIME_MODE || 'direct').toLowerCase();
    return rawMode === 'redis' ? 'redis' : 'direct';
  }

  isWorkerWriteMode(): boolean {
    return this.getWriteMode() === 'worker';
  }

  async upsertDirectConversation(participants: { accountId: string; email?: string; role: string }[], title?: string) {
    // Search existing direct conversation between these participants
    const accountIds = participants.map(p => p.accountId).sort();
    
    const existingConv = await this.convModel.findOne({
      type: 'direct',
      'participants.accountId': { $all: accountIds },
    }).lean();
    
    if (existingConv) {
      console.log('[ChatService] Found existing conversation:', existingConv._id);
      return existingConv;
    }
    
    // Create new conversation if not exists
    const conv = new this.convModel({ type: 'direct', participants, title });
    const saved = await conv.save();
    console.log('[ChatService] Created new conversation:', saved._id);
    return saved;
  }

  async listConversationsByUser(user: AuthUser, skip = 0, limit = 20) {
    const accountId = user?.accountId;
    if (!accountId) {
      return { data: [], total: 0, skip, limit };
    }
    const total = await this.convModel.countDocuments({ 'participants.accountId': accountId });
    const conversations = await this.convModel
      .find({ 'participants.accountId': accountId })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    // Enrich with participant profiles
    const enriched = await Promise.all(
      conversations.map(async (conv) => {
        const participantsWithProfiles = await Promise.all(
          conv.participants.map(async (p) => {
            const account = await this.accountModel.findById(p.accountId).lean();
            const profile = account?.profileId 
              ? await this.profileModel.findById(account.profileId).lean()
              : null;
            return {
              accountId: p.accountId,
              email: p.email,
              role: p.role,
              displayName: profile?.name || account?.email || 'Unknown',
              avatarUrl: profile?.avatarUrl || null,
            };
          }),
        );
        return { ...conv, participants: participantsWithProfiles };
      }),
    );

    return { data: enriched, total, skip, limit };
  }

  async getConversation(conversationId: string) {
    return this.convModel.findById(conversationId).lean();
  }

  async getMessages(conversationId: string, before?: string, limit = 20) {
    try {
      console.log('[ChatService] getMessages called with:', { conversationId, before, limit });
      
      // Validate conversationId format
      if (!Types.ObjectId.isValid(conversationId)) {
        console.error('[ChatService] Invalid conversationId format:', conversationId);
        return [];
      }

      const q: any = { conversationId: new Types.ObjectId(conversationId) };
      if (before) {
        const beforeDate = DateTimeHelper.toUtcDate(before);
        if (beforeDate) q.createdAt = { $lt: beforeDate };
      }
      
      console.log('[ChatService] Query:', q);
      
      const msgs = await this.msgModel
        .find(q)
        // Use _id as tiebreaker to keep deterministic ordering for identical createdAt values.
        .sort({ createdAt: -1, _id: -1 })
        .limit(Math.min(limit, 50))
        .lean();
      
      console.log('[ChatService] Found messages:', msgs.length);
      console.log('[ChatService] Messages:', msgs);
      
      return msgs;
    } catch (error) {
      console.error('[ChatService] Error fetching messages:', error);
      return [];
    }
  }

  async createMessage(payload: {
    conversationId: string;
    senderId: string;
    senderEmail?: string;
    content: string;
    type?: 'text' | 'image' | 'file' | 'system';
    clientMessageId?: string;
    createdAt?: Date;
  }) {
    return this.saveMessageAndUpdateConversation(payload);
  }

  async publishMessageCreatedEvent(payload: ChatMessageCreatedEvent): Promise<void> {
    await this.rabbitMqService.publish(CHAT_MESSAGE_CREATED_QUEUE, payload);
  }

  async publishRealtimeMessage(payload: {
    conversationId: string;
    senderId: string;
    message: unknown;
  }): Promise<void> {
    await this.redisService.publish(CHAT_MESSAGE_REDIS_CHANNEL, payload);
  }

  async processMessageCreatedEvent(event: ChatMessageCreatedEvent): Promise<MessageDocument> {
    if (event.clientMessageId) {
      const duplicate = await this.msgModel
        .findOne({ clientMessageId: event.clientMessageId })
        .select('_id')
        .lean();

      if (duplicate) {
        this.logger.debug(`Skipping duplicate chat event: ${event.clientMessageId}`);
        const existingMessage = await this.msgModel.findById(duplicate._id);
        if (!existingMessage) {
          throw new Error('Duplicate message id found but message document is missing');
        }
        return existingMessage;
      }
    }

    const createdAt = DateTimeHelper.toUtcDate(event.createdAt) || DateTimeHelper.nowUtc();
    const saved = await this.saveMessageAndUpdateConversation({
      conversationId: event.conversationId,
      senderId: event.senderId,
      senderEmail: event.senderEmail,
      content: event.content,
      type: event.type || 'text',
      clientMessageId: event.clientMessageId,
      createdAt,
    });

    // Worker writes to DB then publishes to Redis so gateway can fan out realtime events.
    await this.publishRealtimeMessage({
      conversationId: event.conversationId,
      senderId: event.senderId,
      message: saved,
    });

    return saved;
  }

  async markRead(conversationId: string, user: AuthUser) {
    const accountId = user?.accountId;
    if (!accountId) {
      return null;
    }
    return this.convModel.findByIdAndUpdate(
      conversationId,
      { $set: { 'participants.$[p].lastReadAt': DateTimeHelper.nowUtc() } },
      { arrayFilters: [{ 'p.accountId': accountId }], new: true },
    );
  }

  private async saveMessageAndUpdateConversation(payload: {
    conversationId: string;
    senderId: string;
    senderEmail?: string;
    content: string;
    type?: 'text' | 'image' | 'file' | 'system';
    clientMessageId?: string;
    createdAt?: Date;
  }): Promise<MessageDocument> {
    const doc = new this.msgModel({
      conversationId: new Types.ObjectId(payload.conversationId),
      senderId: payload.senderId,
      senderEmail: payload.senderEmail,
      content: payload.content,
      type: payload.type || 'text',
      clientMessageId: payload.clientMessageId,
      ...(payload.createdAt ? { createdAt: payload.createdAt, updatedAt: payload.createdAt } : {}),
    });

    const saved = await doc.save();
    const persistedCreatedAt = saved.get('createdAt') as Date | undefined;
    const snapshotTime = payload.createdAt || persistedCreatedAt || DateTimeHelper.nowUtc();

    await this.convModel.findByIdAndUpdate(payload.conversationId, {
      $set: {
        lastMessage: {
          content: payload.content,
          senderId: payload.senderId,
          at: snapshotTime,
        },
        updatedAt: snapshotTime,
      },
    });

    return saved;
  }
}
