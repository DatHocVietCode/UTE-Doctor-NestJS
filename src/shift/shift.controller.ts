import { Body, Controller, Post } from "@nestjs/common";
import { RegisterShiftDto } from "./dto/register-shift.dto";
import { ShiftService } from "./shift.service";

@Controller("shift")
export class ShiftController {
  constructor(private readonly shiftService: ShiftService) {}

  @Post("/register")
  async registerShift(@Body() dto: RegisterShiftDto) {
    console.log("Received shift register request:", dto);
    return await this.shiftService.registerShift(dto);
  }
}
