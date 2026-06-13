import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type { AppointmentDocument } from 'src/appointment/schemas/appointment.schema';
import { emitTyped } from 'src/utils/helpers/event.helper';
import type { PaymentSuccessDto } from '../dto/notification-payload.dto';
import { NotificationJobPublisher } from '../notification-job.publisher';

@Injectable()
export class PaymentNotificationListener {
  constructor(
    private readonly notificationPublisher: NotificationJobPublisher,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('payment.update')
  async handlePaymentUpdate(payload: { orderId: string; status: 'COMPLETED' | 'FAILED' }) {
    if (payload.status !== 'COMPLETED' || !payload.orderId) {
      return;
    }

    const appointment = await emitTyped<string, AppointmentDocument>(
      this.eventEmitter,
      'appointment.get.byId',
      payload.orderId,
    );

    const recipientEmail = appointment?.patientEmail;
    if (!recipientEmail) {
      return;
    }

    const normalizedRecipient = recipientEmail.trim().toLowerCase();

    const data: PaymentSuccessDto = {
      orderId: payload.orderId,
      status: 'COMPLETED',
    };

    await this.notificationPublisher.publish({
      type: 'PAYMENT_SUCCESS',
      data,
      createdAt: Date.now(),
      recipientEmail: normalizedRecipient,
      idempotencyKey: `PAYMENT_SUCCESS:${payload.orderId}:${normalizedRecipient}`,
    });
  }
}
