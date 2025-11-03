import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { TimeSlotService } from './timeslot.service';
import { TimeSlotController } from './timelost.controller';
import { TimeSlotListener } from './timeslot.listenner';
import { TimeSlotLog, TimeSlotLogSchema } from './schemas/timeslot-log.schema';
import { TimeSlotData, TimeSlotDataSchema } from './schemas/timeslot-data.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: TimeSlotLog.name, schema: TimeSlotLogSchema }]),
            MongooseModule.forFeature([{ name: TimeSlotData.name, schema: TimeSlotDataSchema }])],
  exports: [TimeSlotService, TimeSlotListener], // để module khác có thể dùng
  providers: [TimeSlotService, TimeSlotListener],
  controllers: [TimeSlotController],
})
export class TimeSlotModule {}
