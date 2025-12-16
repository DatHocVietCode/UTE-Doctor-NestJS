import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "src/common/guards/jws-auth.guard";
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

  @Get('/doctor/:doctorId/date/:date')
  async getShiftByDoctorAndDate(
    @Param('doctorId') doctorId: string,
    @Param('date') date: string,
  ) {
    console.log('[ShiftController] GET shift by doctor and date', { doctorId, date });
    return await this.shiftService.getShiftByDoctorAndDate(doctorId, date);
  }

  @Delete("/:id")
  async deleteShift(@Param("id") id: string) {
    console.log("🔴 [Controller] Yêu cầu xóa ca:", id);
    return await this.shiftService.deleteShiftById(id);
  }

  @Put("/cancel/:id")
  @UseGuards(JwtAuthGuard)
  async cancelShift(@Param("id") id: string, @Body("reason") reason: string, @Req() req: any) {
    console.log("🟠 [Controller] Yêu cầu hủy ca:", id, "Lý do:", reason);
    return await this.shiftService.cancelShiftById(id, reason, req.user);
  }

}
