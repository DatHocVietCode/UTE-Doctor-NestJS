import { Body, Controller, Post } from "@nestjs/common";
import { AppointmentBookingDto } from "./dto/appointment-booking.dto";
import { AppointmentService } from "./appointment.service";

@Controller('appointment')
export class AppointmentController {
    constructor(private readonly appointmentService: AppointmentService) {}
    @Post('/book')
    async bookAppointment(@Body() bookingAppointment: AppointmentBookingDto) {
        console.log('Received appointment booking:', bookingAppointment);
        return await this.appointmentService.bookAppointment(bookingAppointment);
    }
}