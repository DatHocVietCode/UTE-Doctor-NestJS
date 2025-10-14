import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { AppointmentBookingDto } from "./dto/appointment-booking.dto";
import { AppointmentService } from "./appointment.service";
import e from "express";

@Controller('appointment')
export class AppointmentController {
    constructor(private readonly appointmentService: AppointmentService) {}
    @Post('/book')
    async bookAppointment(@Body() bookingAppointment: AppointmentBookingDto) {
        console.log('Received appointment booking:', bookingAppointment);
        return await this.appointmentService.bookAppointment(bookingAppointment);
    }

    @Get('/fields-data')
    async getFieldsData(@Query('email') email: string) {
        console.log('[Controller] Get fields data');
        return await this.appointmentService.getFieldsData(email);
    }
}