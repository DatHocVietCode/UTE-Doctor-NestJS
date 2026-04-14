import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WalletService } from '../../wallet/wallet.service';
import { DateTimeHelper } from 'src/utils/helpers/datetime.helper';

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

            const oldDateText = DateTimeHelper.formatUtc(payload.oldTimeSlotId, 'vi-VN', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            }) ?? 'N/A';
            const newDateText = DateTimeHelper.formatUtc(payload.newDate, 'vi-VN', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            }) ?? 'N/A';

            // Add coins to patient's wallet (80% of consultation fee)
            await this.walletService.addCoins(
                payload.patientId,
                payload.refundAmount,
                `refund-reschedule-${payload.appointmentId}`,
                payload.appointmentId,
                `HoÃ£n lá»‹ch khÃ¡m tá»« ${oldDateText} sang ${newDateText}`
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
