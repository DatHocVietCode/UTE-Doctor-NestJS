import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { Types } from "mongoose";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { AppointmentService } from "./appointment.service";
import { AppointmentBookingDto, CompleteAppointmentDto } from "./dto/appointment-booking.dto";

@Controller('appointment')
export class AppointmentController {
    constructor(private readonly appointmentService: AppointmentService) {}

    @Get()
    async getAllAppointments() {
        return await this.appointmentService.getAllAppointments();
    }

    @Get('/patient')
    async getAppointmentsByPatient(@Query('patientEmail') patientEmail: string) {
        const data = await this.appointmentService.getAppointmentsByPatientEmail(patientEmail);
        const res : DataResponse = {
            code: ResponseCode.SUCCESS,
            message: "Fetched appointments successfully",
            data: data
        }
        return res;
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

    
}