import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Account, AccountDocument } from 'src/account/schemas/account.schema';
import { Profile, ProfileDocument } from 'src/profile/schema/profile.schema';
import { Conversation, ConversationDocument } from './schemas/conversation.schema';
import { Message, MessageDocument } from './schemas/message.schema';
import { AuthUser } from 'src/common/interfaces/auth-user';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Conversation.name) private convModel: Model<ConversationDocument>,
    @InjectModel(Message.name) private msgModel: Model<MessageDocument>,
    @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
    @InjectModel(Profile.name) private profileModel: Model<ProfileDocument>,
  ) {}

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
      if (before) q.createdAt = { $lt: new Date(before) };
      
      console.log('[ChatService] Query:', q);
      
      const msgs = await this.msgModel
        .find(q)
        .sort({ createdAt: -1 })
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
  }) {
    const doc = new this.msgModel({
      conversationId: new Types.ObjectId(payload.conversationId),
      senderId: payload.senderId,
      senderEmail: payload.senderEmail,
      content: payload.content,
      type: payload.type || 'text',
      clientMessageId: payload.clientMessageId,
    });
    const saved = await doc.save();
    await this.convModel.findByIdAndUpdate(payload.conversationId, {
      $set: { lastMessage: { content: payload.content, senderId: payload.senderId, at: new Date() } },
      $currentDate: { updatedAt: true },
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
      { $set: { 'participants.$[p].lastReadAt': new Date() } },
      { arrayFilters: [{ 'p.accountId': accountId }], new: true },
    );
  }
}
