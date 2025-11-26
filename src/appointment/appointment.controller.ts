import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { AppointmentBookingDto, CompleteAppointmentDto } from "./dto/appointment-booking.dto";
import { AppointmentService } from "./appointment.service";
import e from "express";
import { Types } from "mongoose";

@Controller('appointment')
export class AppointmentController {
    constructor(private readonly appointmentService: AppointmentService) {}
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
}