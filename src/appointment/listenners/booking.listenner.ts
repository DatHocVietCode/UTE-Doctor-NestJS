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
    handleBookingPending(payload: AppointmentBookingDto) {
        // Todo: emit tiếp các side-effect
    }

    @OnEvent('appointment.store.booking')
    handleStoreBooking(payload: AppointmentBookingDto) {
        return this.appointmentService.storeBookingInformation(payload);
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
