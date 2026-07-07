import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Appointment, AppointmentSchema } from "src/appointment/schemas/appointment.schema";
import { JwtAuthGuard } from "src/common/guards/jws-auth.guard";
import { Payment, PaymentSchema } from "src/payment/schemas/payment.schema";
import { Shift, ShiftSchema } from "src/shift/schema/shift.schema";
import { ShiftController } from "src/shift/shift.controller";
import { ShiftService } from "src/shift/shift.service";
import { TimeSlotData, TimeSlotDataSchema } from "src/timeslot/schemas/timeslot-data.schema";
import { TimeSlotLog, TimeSlotLogSchema } from "src/timeslot/schemas/timeslot-log.schema";
import { CreditModule } from "src/wallet/credit/credit.module";
import { ShiftListener } from "./shift.listenner";


@Module({
  imports: [
    MongooseModule.forFeature([
  { name: Shift.name, schema: ShiftSchema },
  { name: TimeSlotLog.name, schema: TimeSlotLogSchema },
  { name: TimeSlotData.name, schema: TimeSlotDataSchema },
  { name: Appointment.name, schema: AppointmentSchema },
  { name: Payment.name, schema: PaymentSchema }
    ]),
    CreditModule,
  ],
  controllers: [ShiftController],
  providers: [ShiftService, ShiftListener, JwtAuthGuard],
  exports: [ShiftService, MongooseModule, ShiftListener],
})
export class ShiftModule {
  constructor() {
    console.log("🚀 ShiftModule đã load");
  }
}
