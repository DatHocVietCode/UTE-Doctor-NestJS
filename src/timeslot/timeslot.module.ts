import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TimeSlot, TimeSlotSchema } from './timeslot.schema';
import { TimeSlotService } from './timeslot.service';
import { TimeSlotController } from './timelost.controller';
import { TimeSlotListener } from './timeslot.listenner';

@Module({
  imports: [MongooseModule.forFeature([{ name: TimeSlot.name, schema: TimeSlotSchema }])],
  exports: [TimeSlotService, TimeSlotListener], // để module khác có thể dùng
  providers: [TimeSlotService, TimeSlotListener],
  controllers: [TimeSlotController],
})
export class TimeSlotModule {}
