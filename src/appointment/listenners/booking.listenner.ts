import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { AppointmentBookingDto } from "../dto/appointment-booking.dto";

@Injectable()
export class BookingListener {
    constructor(private readonly eventEmitter: EventEmitter2) {}

    @OnEvent('appointment.booking.completed')
    handleBookingCompleted(payload: AppointmentBookingDto) {
        // emit tiếp các side-effect
        this.eventEmitter.emit('patient.notify', payload.patientEmail);
        this.eventEmitter.emit('doctor.notify', payload.bacSi?.id);
        this.eventEmitter.emit('appointment.socket.notify.success', payload);
        this.eventEmitter.emit('doctor.update-schedule', { doctor: payload.bacSi, payload });
    }

    @OnEvent('appointment.booking.pending')
    handleBookingPending(payload: AppointmentBookingDto) {
        // thông báo pending cho receptionist & patient
        this.eventEmitter.emit('patient.notify', payload.patientEmail);
        this.eventEmitter.emit('receptionist.notify');
    }
}
