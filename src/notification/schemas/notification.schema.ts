import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';
import { Profile } from 'src/profile/schema/profile.schema';

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

  @Prop({ required: false })
  senderEmail?: string;

  // receiver có thể là nhiều người
  @Prop({ type: [String], required: false })
  receiverEmail?: string[];

  // gửi broadcast cho tất cả user
  @Prop({ default: false })
  isBroadcast: boolean;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
