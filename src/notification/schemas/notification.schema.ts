import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { NOTIFICATION_RECIPIENT_ROLES } from '../dto/notification-payload.dto';
import type {
  NotificationRecipientRole,
  NotificationType,
} from '../dto/notification-payload.dto';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: true })
export class Notification {
  _id: mongoose.Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({ type: String, required: false, index: true })
  type?: NotificationType;

  @Prop({ required: false })
  titleKey?: string;

  @Prop({ required: false })
  messageKey?: string;

  @Prop({ default: false })
  isRead: boolean;

  // receiver có thể là nhiều người
  @Prop({ type: [String], required: false })
  receiverEmail?: string[];

  // Single-recipient ownership fields make notification rows auditable by audience.
  @Prop({ required: false, index: true })
  recipientEmail?: string;

  @Prop({ type: String, required: false, enum: NOTIFICATION_RECIPIENT_ROLES })
  recipientRole?: NotificationRecipientRole;

  // gửi broadcast cho tất cả user
  @Prop({ default: false })
  isBroadcast: boolean;

  // Optional structured payload for FE to render without parsing message text.
  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  details?: Record<string, unknown>;

  // Structured FE-render data. Date/time fields must remain epoch milliseconds.
  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  data?: Record<string, unknown>;

  // Retry-safe dedup key: unique per notification business event and recipient.
  @Prop({ required: false, unique: true, sparse: true, index: true })
  idempotencyKey?: string;

  @Prop({ default: Date.now })
  createdAt?: Date;

  @Prop({ default: Date.now })
  updatedAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
