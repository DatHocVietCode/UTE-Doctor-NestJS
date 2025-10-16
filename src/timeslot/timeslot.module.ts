import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TimeSlot, TimeSlotSchema } from './timeslot.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: TimeSlot.name, schema: TimeSlotSchema }])],
  exports: [MongooseModule], // để module khác có thể dùng
})
export class TimeSlotModule {}
