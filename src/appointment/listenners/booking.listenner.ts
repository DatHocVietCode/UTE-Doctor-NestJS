import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { AppointmentBookingDto } from "../dto/appointment-booking.dto";
import { AppointmentService } from "../appointment.service";

@Injectable()
export class BookingListener {
    constructor(private readonly eventEmitter: EventEmitter2,
        private readonly appointmentService: AppointmentService
    ) {}

    @OnEvent('appointment.booking.success')
    handleBookingCompleted(payload: AppointmentBookingDto) {
        // emit tiếp các side-effect
        this.eventEmitter.emit('notify.patient.booking.success', payload);
        this.eventEmitter.emit('notify.doctor.booking.success', payload);
        this.eventEmitter.emit('mail.patient.booking.success', payload);
        this.eventEmitter.emit('mail.doctor.booking.success', payload);
        this.eventEmitter.emit('socket.appointment.success', payload);
        this.eventEmitter.emit('doctor.update-schedule', payload); // Notify doctor module to update schedule
    }

    @OnEvent('appointment.booking.pending')
    handleBookingPending(payload: AppointmentBookingDto) {
        // Todo: emit tiếp các side-effect
    }

    @OnEvent('appointment.store.booking')
    handleStoreBooking(payload: AppointmentBookingDto) {
        return this.appointmentService.storeBookingInformation(payload);
    }

}
