import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: true })
export class Notification {
  _id: mongoose.Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({ default: false })
  isRead: boolean;

  // receiver có thể là nhiều người
  @Prop({ type: [String], required: false })
  receiverEmail?: string[];

  // gửi broadcast cho tất cả user
  @Prop({ default: false })
  isBroadcast: boolean;

  // Optional structured payload for FE to render without parsing message text.
  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  details?: Record<string, unknown>;

  @Prop({ default: Date.now })
  createdAt?: Date;

  @Prop({ default: Date.now })
  updatedAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
