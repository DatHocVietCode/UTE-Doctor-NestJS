import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CreditService } from '../../wallet/credit/credit.service';

@Injectable()
export class CancelListener {
    private readonly logger = new Logger(CancelListener.name);

    constructor(private readonly creditService: CreditService) {}

    @OnEvent('wallet.refund.shift.cancelled')
    async handleShiftCancelledRefund(payload: {
        appointmentId: string;
        patientId: string;
        refundAmount: number;
        reason: string;
    }) {
        try {
            const idempotencyReason = `refund-shift-cancel-${payload.appointmentId}`;
            const alreadyRefunded = await this.creditService.hasCompletedCreditTransaction(
                payload.appointmentId,
                idempotencyReason,
            );

            if (alreadyRefunded) {
                this.logger.warn(
                    `Skip duplicate shift-cancel refund for appointment ${payload.appointmentId}`,
                );
                return;
            }

            const normalizedRefundAmount = Math.max(0, Math.floor(payload.refundAmount || 0));
            if (normalizedRefundAmount <= 0) {
                this.logger.warn(
                    `Skip shift-cancel refund for appointment ${payload.appointmentId}: normalized refund is 0`,
                );
                return;
            }

            this.logger.debug(
                `Processing refund for shift cancellation (appointment ${payload.appointmentId}): ${normalizedRefundAmount} credit`
            );

            // Shift-cancellation refund also goes to credit wallet.
            await this.creditService.addCredit(
                payload.patientId,
                normalizedRefundAmount,
                idempotencyReason,
                payload.appointmentId,
                payload.reason
            );

            this.logger.log(
                `Successfully credited ${normalizedRefundAmount} credit to patient ${payload.patientId} for shift cancellation (appointment ${payload.appointmentId})`
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
