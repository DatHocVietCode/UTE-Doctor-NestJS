import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CreditService } from '../../wallet/credit/credit.service';

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
            const idempotencyReason = `refund-cancel-${payload.appointmentId}`;
            const alreadyRefunded = await this.creditService.hasCompletedCreditTransaction(
                payload.appointmentId,
                idempotencyReason,
            );

            if (alreadyRefunded) {
                this.logger.warn(
                    `Skip duplicate cancel refund for appointment ${payload.appointmentId}`,
                );
                return;
            }

            // Refund must never exceed original charged fee.
            const normalizedRefundAmount = Math.max(
                0,
                Math.min(
                    Math.floor(payload.refundAmount || 0),
                    Math.max(0, Math.floor(payload.consultationFee || 0)),
                ),
            );

            if (normalizedRefundAmount <= 0) {
                this.logger.warn(
                    `Skip cancel refund for appointment ${payload.appointmentId}: normalized refund is 0`,
                );
                return;
            }

            this.logger.debug(
                `Processing refund for cancelled appointment ${payload.appointmentId}: ${normalizedRefundAmount} credit`
            );

            // Refund monetary value to credit wallet; coin wallet is reward-only.
            await this.creditService.addCredit(
                payload.patientId,
                normalizedRefundAmount,
                idempotencyReason,
                payload.appointmentId,
                'Huy lich kham, hoan tien vao credit'
            );

            this.logger.log(
                `Successfully credited ${normalizedRefundAmount} credit to patient ${payload.patientId} for cancelled appointment ${payload.appointmentId}`
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
