import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

@Schema({ timestamps: true })
export class Message {
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true })
  conversationId: Types.ObjectId;

  @Prop({ required: true })
  senderId: string;

  @Prop()
  senderEmail?: string;

  @Prop({ required: true })
  content: string;

  @Prop({ enum: ['text', 'image', 'file', 'system'], default: 'text' })
  type: 'text' | 'image' | 'file' | 'system';

  @Prop()
  clientMessageId?: string;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ clientMessageId: 1 }, { unique: true, sparse: true });