import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ShiftController } from "src/shift/shift.controller";
import { ShiftService } from "src/shift/shift.service";
import { Shift, ShiftSchema } from "src/shift/schema/shift.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Shift.name, schema: ShiftSchema },
    ]),
  ],
  controllers: [ShiftController],
  providers: [ShiftService],
  exports: [ShiftService, MongooseModule],
})
export class ShiftModule {
  constructor() {
    console.log("🚀 ShiftModule đã load");
  }
}
