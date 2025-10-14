import { Injectable } from "@nestjs/common";
import { AppointmentBookingDto } from "./dto/appointment-booking.dto";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode } from "src/common/enum/reponse-code.enum";

@Injectable()
export class AppointmentService {
    constructor(private readonly eventEmitter: EventEmitter2) {}

    async bookAppointment(bookingAppointment: AppointmentBookingDto) {
        // emit event
        this.eventEmitter.emit('appointment.booked', bookingAppointment);
        const dataResponse : DataResponse = {
            code: ResponseCode.PENDING,
            message: 'Appointment booking is being processed',
            data: null
        }
        return dataResponse;
    }

    async getFieldsData(email: string) {

        this.eventEmitter.emit('appointment.get-hospitals-specialties', email);
        const dataResponse : DataResponse = {
            code: ResponseCode.SUCCESS, 
            message: 'Server received the request for fields data',
            data: null
        }
        return dataResponse;
    }

}