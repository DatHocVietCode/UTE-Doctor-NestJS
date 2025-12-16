import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Types } from "mongoose";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { JwtAuthGuard } from "src/common/guards/jws-auth.guard";
import { AppointmentService } from "./appointment.service";
import { AppointmentBookingDto, CompleteAppointmentDto, RescheduleAppointmentDto } from "./dto/appointment-booking.dto";

@Controller('appointment')
export class AppointmentController {
    constructor(private readonly appointmentService: AppointmentService) {}

    @Get('admin')
    async getAppointments(@Query() query: any) {
        return this.appointmentService.findAll(query);
    }

    @Get()
    async getAllAppointments() {
        return await this.appointmentService.getAllAppointments();
    }

    @Get('/patient')
    @UseGuards(JwtAuthGuard)
    async getAppointmentsByPatient(
    @Req() req: any,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10'
    ) {
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, Math.min(50, parseInt(limit) || 10));

        const patientEmail = req.user.email;

        const data = await this.appointmentService.getAppointmentsByPatientEmail(
        patientEmail,
        pageNum,
        limitNum
        );

        return {
        code: ResponseCode.SUCCESS,
        message: "Fetched appointments successfully",
        data,
        };
    }


    @Post('/book')
    async bookAppointment(@Body() bookingAppointment: AppointmentBookingDto) {
        console.log('Received appointment booking:', bookingAppointment);
        return await this.appointmentService.bookAppointment(bookingAppointment);
    }

    @Get('/today')
    async getTodayAppointments(@Query('doctorId') doctorId: string) {
        console.log(`[AppointmentController] GET /today?doctorId=${doctorId}`);
        try {
            const res = await this.appointmentService.getTodayAppointments(doctorId);
            console.log('[AppointmentController] Response data:', JSON.stringify(res?.data ?? res));
            return res;
        } catch (error) {
            console.error('[AppointmentController] Error in getTodayAppointments:', error?.message ?? error);
            throw error;
        }
    }

    @Patch('/complete')
    async completeAppointment(@Body() dto: CompleteAppointmentDto) {
        return await this.appointmentService.completeAppointment(dto);
  }

  @Get(':id')
    async getAppointmentById(@Param('id') id: string) {
        // Validate ObjectId
        if (!Types.ObjectId.isValid(id)) {
        throw new NotFoundException('Invalid appointment ID');
        }

        const appointment = await this.appointmentService.findById(id);

        if (!appointment) {
        throw new NotFoundException('Appointment not found');
        }

        return appointment;
    }
    @Patch('/reschedule')
    @UseGuards(JwtAuthGuard)
    async rescheduleAppointment(@Body() dto: RescheduleAppointmentDto, @Req() req: any) {
        try {
            const newDate = new Date(dto.newDate);
            const result = await this.appointmentService.rescheduleAppointment(
                dto.appointmentId,
                newDate,
                dto.newTimeSlotId,
                dto.reason
            );
            return result;
        } catch (error: any) {
            throw new Error(`Failed to reschedule appointment: ${error.message}`);
        }
    }

    @Patch('/cancel')
    @UseGuards(JwtAuthGuard)
    async cancelAppointment(@Body() dto: { appointmentId: string; reason?: string }, @Req() req: any) {
        try {
            const result = await this.appointmentService.cancelAppointment(
                dto.appointmentId,
                dto.reason
            );
            return result;
        } catch (error: any) {
            throw new Error(`Failed to cancel appointment: ${error.message}`);
        }
    }

    @Patch(':id/confirm')
    confirmAppointment(@Param('id') id: string) {
        return this.appointmentService.confirmAppointment(id);
    }

}