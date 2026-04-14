import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ConversationDocument = HydratedDocument<Conversation>;

export class ConversationParticipant {
  @Prop({ required: true })
  accountId: string;

  @Prop()
  email?: string;

  @Prop({ required: true })
  role: string;

  @Prop()
  lastReadAt?: Date;
}

@Schema({ timestamps: true })
export class Conversation {
  @Prop({ enum: ['direct', 'group'], default: 'direct' })
  type: 'direct' | 'group';

  @Prop({ type: [{ type: Object }], required: true })
  participants: ConversationParticipant[];

  @Prop()
  title?: string;

  @Prop({ type: Object })
  lastMessage?: any;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ 'participants.accountId': 1, updatedAt: -1 });