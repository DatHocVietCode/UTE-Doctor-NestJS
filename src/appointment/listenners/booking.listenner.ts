import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { WalletService } from "../../wallet/wallet.service";
import { AppointmentService } from "../appointment.service";
import { AppointmentBookingDto } from "../dto/appointment-booking.dto";
import { AppointmentStatus } from "../enums/Appointment-status.enum";
import * as appointmentEnriched from "../schemas/appointment-enriched";

@Injectable()
export class BookingListener {
    private readonly logger = new Logger(BookingListener.name);

    constructor(
        private readonly eventEmitter: EventEmitter2,
        private readonly appointmentService: AppointmentService,
        private readonly walletService: WalletService
    ) {}

    @OnEvent('appointment.booking.success')
    handleBookingCompleted(payload: appointmentEnriched.AppointmentEnriched) {
        // emit tiếp các side-effect
        this.appointmentService.updateAppointmentStatus(payload._id.toString(), AppointmentStatus.CONFIRMED);
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
        
        // Update appointment status to PENDING
        this.appointmentService.updateAppointmentStatus(payload._id.toString(), AppointmentStatus.PENDING);
        
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

    @OnEvent('appointment.store.booking')
    handleStoreBooking(payload: AppointmentBookingDto) {
        return this.appointmentService.storeBookingInformation(payload);
    }

    @OnEvent('appointment.booking.failed')
    handleBookingValidationFailed(payload: { dto?: AppointmentBookingDto; reason?: string; appointmentId?: string }) {
        this.logger.warn(`Processing booking validation failure:`, payload);
        
        const patientEmail = payload.dto?.patientEmail;
        const appointmentId = payload.appointmentId;
        
        if (patientEmail) {
            // Notify patient of booking failure
            this.eventEmitter.emit('notify.patient.booking.failed', {
                patientEmail,
                reason: payload.reason || 'Booking validation failed',
                appointmentId
            });
            
            // Send failure email to patient
            this.eventEmitter.emit('mail.patient.booking.failed', {
                patientEmail,
                reason: payload.reason || 'Booking validation failed',
                appointmentId
            });
        }
        
        // Notify client via socket about booking failure
        this.eventEmitter.emit('socket.appointment.failed', {
            success: false,
            error: payload.reason || 'Booking validation failed',
            appointmentId,
            patientEmail
        });
        
        this.logger.log(`Booking validation failure notification sent for ${patientEmail}`);
    }

    @OnEvent('appointment.payment.failed')
    handlePaymentFailed(payload: { dto?: AppointmentBookingDto; reason?: string; appointmentId?: string }) {
        this.logger.warn(`Processing payment failure:`, payload);
        
        const patientEmail = payload.dto?.patientEmail;
        const appointmentId = payload.appointmentId;
        
        if (patientEmail) {
            // Notify patient of payment failure
            this.eventEmitter.emit('notify.patient.booking.failed', {
                patientEmail,
                reason: payload.reason || 'Payment processing failed',
                appointmentId
            });
            
            // Send failure email to patient
            this.eventEmitter.emit('mail.patient.booking.failed', {
                patientEmail,
                reason: payload.reason || 'Payment processing failed',
                appointmentId
            });
        }
        
        // Notify client via socket about payment failure
        this.eventEmitter.emit('socket.appointment.failed', {
            success: false,
            error: payload.reason || 'Payment processing failed',
            appointmentId,
            patientEmail
        });
        
        this.logger.log(`Payment failure notification sent for ${patientEmail}`);
    }

    /**
     * Handle coin deduction when appointment is booked with coins
     */
    @OnEvent('appointment.booking.coin-deduction')
    async handleCoinDeduction(payload: {
        appointmentId: string;
        patientId: string;
        coinsUsed: number;
        consultationFee: number;
    }) {
        try {
            this.logger.debug(
                `Processing coin deduction for appointment ${payload.appointmentId}: ${payload.coinsUsed} coins`
            );

            // Deduct coins from patient's wallet for appointment payment
            await this.walletService.deductCoins(
                payload.patientId,
                payload.coinsUsed,
                'appointment_booking',
                payload.appointmentId,
                `Thanh toán khám chữa bệnh bằng ${payload.coinsUsed} coin (phí: ${payload.consultationFee})`
            );

            this.logger.log(
                `Successfully deducted ${payload.coinsUsed} coins from patient ${payload.patientId} for appointment ${payload.appointmentId}`
            );
        } catch (error: any) {
            this.logger.error(
                `Failed to deduct coins for appointment ${payload.appointmentId}: ${error.message}`,
                error.stack
            );
            // Log error but don't throw - booking should succeed even if coin deduction fails
            // Admin can manually process refund if needed
        }
    }

}
