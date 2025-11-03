import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ShiftController } from "src/shift/shift.controller";
import { ShiftService } from "src/shift/shift.service";
import { Shift, ShiftSchema } from "src/shift/schema/shift.schema";
import { ShiftListener } from "./shift.listenner";
import { TimeSlotLog, TimeSlotLogSchema } from "src/timeslot/schemas/timeslot-log.schema";


@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Shift.name, schema: ShiftSchema },
      { name: TimeSlotLog.name, schema: TimeSlotLogSchema }
    ]),
  ],
  controllers: [ShiftController],
  providers: [ShiftService, ShiftListener],
  exports: [ShiftService, MongooseModule, ShiftListener],
})
export class ShiftModule {
  constructor() {
    console.log("🚀 ShiftModule đã load");
  }
}
