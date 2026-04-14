import { Module } from "@nestjs/common";
import { ShiftModule } from "src/shift/shift.module";
import { RegisterShiftSaga } from "./sagas/register-shift.saga";

@Module({
  imports: [ShiftModule],
  providers: [RegisterShiftSaga],
})
export class OrchestrationModule {}
