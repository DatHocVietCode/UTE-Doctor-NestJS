import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CreditService } from '../../wallet/credit.service';

@Injectable()
export class CancelListener {
    private readonly logger = new Logger(CancelListener.name);

    constructor(private readonly creditService: CreditService) {}

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
                `Processing refund for cancelled appointment ${payload.appointmentId}: ${payload.refundAmount} credit`
            );

            // Refund monetary value to credit wallet; coin wallet is reward-only.
            await this.creditService.addCredit(
                payload.patientId,
                payload.refundAmount,
                `refund-cancel-${payload.appointmentId}`,
                payload.appointmentId,
                'Huy lich kham, hoan tien vao credit'
            );

            this.logger.log(
                `Successfully credited ${payload.refundAmount} credit to patient ${payload.patientId} for cancelled appointment ${payload.appointmentId}`
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
                `Processing refund for shift cancellation (appointment ${payload.appointmentId}): ${payload.refundAmount} credit`
            );

            // Shift-cancellation refund also goes to credit wallet.
            await this.creditService.addCredit(
                payload.patientId,
                payload.refundAmount,
                `refund-shift-cancel-${payload.appointmentId}`,
                payload.appointmentId,
                payload.reason
            );

            this.logger.log(
                `Successfully credited ${payload.refundAmount} credit to patient ${payload.patientId} for shift cancellation (appointment ${payload.appointmentId})`
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
