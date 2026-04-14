import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import * as appointmentEnriched from "../schemas/appointment-enriched";

@Injectable()
export class BookingListener {
    private readonly logger = new Logger(BookingListener.name);

    constructor(
        private readonly eventEmitter: EventEmitter2,
    ) {}

    @OnEvent('appointment.booking.success')
    handleBookingCompleted(payload: appointmentEnriched.AppointmentEnriched) {
        this.eventEmitter.emit('notify.patient.booking.success', payload);
        this.eventEmitter.emit('notify.doctor.booking.success', payload);
        this.eventEmitter.emit('mail.patient.booking.success', payload);
        this.eventEmitter.emit('mail.doctor.booking.success', payload);
        this.eventEmitter.emit('socket.appointment.success', payload);
        this.eventEmitter.emit('doctor.update-schedule', payload); // Notify doctor module to update schedule
    }

    @OnEvent('appointment.booking.pending')
    handleBookingPending(payload: appointmentEnriched.AppointmentEnriched) {
        this.logger.debug(`Processing pending booking for appointment ${payload._id}`);
        // Notify patient
        this.eventEmitter.emit('notify.patient.booking.pending', payload);
        
        // Send email confirmation to patient
        this.eventEmitter.emit('mail.patient.booking.pending', payload);
        
        // TODO: Notify active receptionist when receptionist module is implemented
        // this.eventEmitter.emit('notify.receptionist.booking.pending', payload);
        
        // Notify client via socket
        this.eventEmitter.emit('socket.appointment.pending', payload);
        
        this.logger.log(`Pending booking processed for appointment ${payload._id}`);
    }

    @OnEvent('appointment.booking.failed')
    handleBookingFailed(payload: { patientEmail?: string; reason?: string; appointmentId?: string }) {
        this.logger.warn(`Processing booking failure:`, payload);

        const patientEmail = payload.patientEmail;
        const appointmentId = payload.appointmentId;

        if (patientEmail) {
            this.eventEmitter.emit('notify.patient.booking.failed', {
                patientEmail,
                reason: payload.reason || 'Payment processing failed',
                appointmentId,
            });

            this.eventEmitter.emit('mail.patient.booking.failed', {
                patientEmail,
                reason: payload.reason || 'Payment processing failed',
                appointmentId,
            });
        }

        this.eventEmitter.emit('socket.appointment.failed', {
            success: false,
            error: payload.reason || 'Payment processing failed',
            appointmentId,
            patientEmail,
        });

        this.logger.log(`Booking failure notification sent for ${patientEmail}`);
    }

}
