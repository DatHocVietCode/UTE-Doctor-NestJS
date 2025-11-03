import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ShiftController } from "src/shift/shift.controller";
import { ShiftService } from "src/shift/shift.service";
import { Shift, ShiftSchema } from "src/shift/schema/shift.schema";
import { ShiftListener } from "./shift.listenner";
import { TimeSlot, TimeSlotSchema } from "src/timeslot/timeslot.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Shift.name, schema: ShiftSchema },
      { name: TimeSlot.name, schema: TimeSlotSchema }
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
