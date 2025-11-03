import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type TimeSlotLogDocument = HydratedDocument<TimeSlotLog>;

@Schema({ timestamps: true, collection: 'timeslotslog' })
export class TimeSlotLog {
  _id: mongoose.Types.ObjectId;

  @Prop({ required: true })
  start: string; // e.g., "08:00"

  @Prop({ required: true })
  end: string; // e.g., "09:00"

  @Prop()
  label?: string; // e.g., "Ca sáng - Slot 1"

  @Prop({
    type: String,
    enum: ['available', 'booked', 'completed', 'canceled'],
    default: 'available',
  })
  status: 'available' | 'booked' | 'completed' | 'canceled';
}

export const TimeSlotLogSchema = SchemaFactory.createForClass(TimeSlotLog);
