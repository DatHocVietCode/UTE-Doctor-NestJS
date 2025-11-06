import { Injectable } from "@nestjs/common";
import { AppointmentBookingDto } from "./dto/appointment-booking.dto";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Appointment } from "./schemas/appointment.schema";

@Injectable()
export class AppointmentService {
    constructor(private readonly eventEmitter: EventEmitter2,
        @InjectModel(Appointment.name) private readonly appointmentModel: Model<Appointment>
    ) {}

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

    async storeBookingInformation(payload: AppointmentBookingDto) {
        const appointmentDoc = new this.appointmentModel({
            date: payload.date,
            appointmentStatus: 'PENDING', // default
            serviceType: payload.serviceType,
            consultationFee: payload.amount ?? undefined, // nếu amount có thì lưu
            timeSlot: payload.timeSlotId,
            patientId: payload.patientId,
            doctorId: payload.doctor?.id ?? undefined, // nếu null thì bỏ qua
            reasonForAppointment: payload.reasonForAppointment,
            specialtyId: payload.specialty
        });

        console.log('Storing appointment booking information:', appointmentDoc);
        const saved = await appointmentDoc.save();
        return saved;
    }

}