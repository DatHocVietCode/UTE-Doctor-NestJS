import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type TimeSlotDocument = HydratedDocument<TimeSlot>;

@Schema()
export class TimeSlot {
  _id: mongoose.Types.ObjectId;
  @Prop({ required: true }) start: string; // e.g., "08:00"
  @Prop({ required: true }) end: string;   // e.g., "09:00"
  @Prop() label?: string; // e.g., "Ca sáng - Slot 1"
}

export const TimeSlotSchema = SchemaFactory.createForClass(TimeSlot);
