import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WalletService } from '../../wallet/wallet.service';

@Injectable()
export class RescheduleListener {
    private readonly logger = new Logger(RescheduleListener.name);

    constructor(private readonly walletService: WalletService) {}

    @OnEvent('appointment.rescheduled')
    async handleAppointmentRescheduled(payload: {
        appointmentId: string;
        patientId: string;
        consultationFee: number;
        refundAmount: number;
        reason?: string;
        oldTimeSlotId: string;
        newTimeSlotId: string;
        newDate: Date;
    }) {
        try {
            this.logger.debug(
                `Processing refund for appointment ${payload.appointmentId}: ${payload.refundAmount} coins`
            );

            // Add coins to patient's wallet (80% of consultation fee)
            await this.walletService.addCoins(
                payload.patientId,
                payload.refundAmount,
                `refund-reschedule-${payload.appointmentId}`
            );

            this.logger.log(
                `Successfully credited ${payload.refundAmount} coins to patient ${payload.patientId} for rescheduled appointment ${payload.appointmentId}`
            );
        } catch (error: any) {
            this.logger.error(
                `Failed to process refund for appointment ${payload.appointmentId}: ${error.message}`,
                error.stack
            );
            // Log error but don't throw - reschedule should succeed even if refund processing fails
            // Admin can manually process refund later if needed
        }
    }
}
