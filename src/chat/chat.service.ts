import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Account, AccountDocument } from 'src/account/schemas/account.schema';
import { Profile, ProfileDocument } from 'src/profile/schema/profile.schema';
import { Conversation, ConversationDocument } from './schemas/conversation.schema';
import { Message, MessageDocument } from './schemas/message.schema';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Conversation.name) private convModel: Model<ConversationDocument>,
    @InjectModel(Message.name) private msgModel: Model<MessageDocument>,
    @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
    @InjectModel(Profile.name) private profileModel: Model<ProfileDocument>,
  ) {}

  async upsertDirectConversation(participants: { accountId: string; email?: string; role: string }[], title?: string) {
    // naive: create new; future: search existing by participant set
    const conv = new this.convModel({ type: 'direct', participants, title });
    return await conv.save();
  }

  async listConversationsByUser(accountId: string) {
    return this.convModel
      .find({ 'participants.accountId': accountId })
      .sort({ updatedAt: -1 })
      .lean();
  }

  async getConversation(conversationId: string) {
    return this.convModel.findById(conversationId).lean();
  }

  async getMessages(conversationId: string, before?: string, limit = 20) {
    const q: any = { conversationId: new Types.ObjectId(conversationId) };
    if (before) q.createdAt = { $lt: new Date(before) };
    return this.msgModel
      .find(q)
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 50))
      .lean();
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

  async markRead(conversationId: string, accountId: string) {
    return this.convModel.findByIdAndUpdate(
      conversationId,
      { $set: { 'participants.$[p].lastReadAt': new Date() } },
      { arrayFilters: [{ 'p.accountId': accountId }], new: true },
    );
  }
}