import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { AppointmentBookingDto } from "../dto/appointment-booking.dto";

@Injectable()
export class BookingListener {
    constructor(private readonly eventEmitter: EventEmitter2) {}

    @OnEvent('appointment.booking.success')
    handleBookingCompleted(payload: AppointmentBookingDto) {
        // emit tiếp các side-effect
        this.eventEmitter.emit('notify.patient.booking.success', payload);
        this.eventEmitter.emit('notify.doctor.booking.success', payload);
        this.eventEmitter.emit('socket.appointment.success', payload);
        this.eventEmitter.emit('doctor.update-schedule', { doctor: payload.doctor, payload }); // Notify doctor module to update schedule
    }

    @OnEvent('appointment.booking.pending')
    handleBookingPending(payload: AppointmentBookingDto) {
        // thông báo pending cho receptionist & patient
        this.eventEmitter.emit('patient.notify', payload.patientEmail);
        this.eventEmitter.emit('receptionist.notify');
    }
}
