import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards, UnauthorizedException } from "@nestjs/common";
import { JwtAuthGuard } from "src/common/guards/jws-auth.guard";
import { AuthUser } from "src/common/interfaces/auth-user";
import { RegisterShiftDto, RegisterShiftRequestDto } from "./dto/register-shift.dto";
import { ShiftService } from "./shift.service";

@Controller("shift")
export class ShiftController {
  constructor(private readonly shiftService: ShiftService) {}

  @Post("/register")
  @UseGuards(JwtAuthGuard)
  async registerShift(@Req() req: any, @Body() dto: RegisterShiftRequestDto) {
    const user = req.user as AuthUser;
    if (!user?.doctorId) {
      throw new UnauthorizedException('Unable to identify doctor from token');
    }
    console.log("🔵 [Controller] Received shift register request:", dto);

    const payload: RegisterShiftDto = {
      ...dto,
      doctorId: user.doctorId,
    };
    const result = await this.shiftService.registerShift(payload);

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
