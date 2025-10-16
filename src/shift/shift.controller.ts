import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { RegisterShiftDto } from "./dto/register-shift.dto";
import { ShiftService } from "./shift.service";

@Controller("shift")
export class ShiftController {
  constructor(private readonly shiftService: ShiftService) {}

 @Post("/register")
  async registerShift(@Body() dto: RegisterShiftDto) {
    console.log("🔵 [Controller] Received shift register request:", dto);
    
    const result = await this.shiftService.registerShift(dto);
    
    console.log("🔵 [Controller] Returning response:", result);
    
    return result;
  }

  @Get("/doctor/:doctorId/month")
  async getShiftsByMonth(
    @Param("doctorId") doctorId: string,
    @Query("month") month: string,
    @Query("year") year: string,
    @Query("status") status?: string
  ) {
    console.log("🔵 [Controller] Get shifts by month:", { 
      doctorId, 
      month, 
      year, 
      status 
    });
    
    return await this.shiftService.getShiftsByMonth(doctorId, month, year, status);
  }

  @Delete("/:id")
  async deleteShift(@Param("id") id: string) {
    console.log("🔴 [Controller] Yêu cầu xóa ca:", id);
    return await this.shiftService.deleteShiftById(id);
  }

}
