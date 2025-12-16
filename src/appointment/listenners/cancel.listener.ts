import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WalletService } from '../../wallet/wallet.service';

@Injectable()
export class CancelListener {
    private readonly logger = new Logger(CancelListener.name);

    constructor(private readonly walletService: WalletService) {}

    @OnEvent('appointment.cancelled')
    async handleAppointmentCancelled(payload: {
        appointmentId: string;
        patientId: string;
        consultationFee: number;
        refundAmount: number;
        reason?: string;
        timeSlotId: string;
    }) {
        try {
            this.logger.debug(
                `Processing refund for cancelled appointment ${payload.appointmentId}: ${payload.refundAmount} coins`
            );

            // Add coins to patient's wallet (100% of consultation fee)
            await this.walletService.addCoins(
                payload.patientId,
                payload.refundAmount,
                `refund-cancel-${payload.appointmentId}`,
                payload.appointmentId,
                `Hủy lịch khám, hoàn 100% coin`
            );

            this.logger.log(
                `Successfully credited ${payload.refundAmount} coins to patient ${payload.patientId} for cancelled appointment ${payload.appointmentId}`
            );
        } catch (error: any) {
            this.logger.error(
                `Failed to process refund for cancelled appointment ${payload.appointmentId}: ${error.message}`,
                error.stack
            );
            // Log error but don't throw - cancellation should succeed even if refund processing fails
            // Admin can manually process refund later if needed
        }
    }

    @OnEvent('wallet.refund.shift.cancelled')
    async handleShiftCancelledRefund(payload: {
        appointmentId: string;
        patientId: string;
        refundAmount: number;
        reason: string;
    }) {
        try {
            this.logger.debug(
                `Processing refund for shift cancellation (appointment ${payload.appointmentId}): ${payload.refundAmount} coins`
            );

            // Add coins to patient's wallet
            await this.walletService.addCoins(
                payload.patientId,
                payload.refundAmount,
                `refund-shift-cancel-${payload.appointmentId}`,
                payload.appointmentId,
                payload.reason
            );

            this.logger.log(
                `Successfully credited ${payload.refundAmount} coins to patient ${payload.patientId} for shift cancellation (appointment ${payload.appointmentId})`
            );
        } catch (error: any) {
            this.logger.error(
                `Failed to process refund for shift cancellation (appointment ${payload.appointmentId}): ${error.message}`,
                error.stack
            );
            // Log error but don't throw
        }
    }
}
