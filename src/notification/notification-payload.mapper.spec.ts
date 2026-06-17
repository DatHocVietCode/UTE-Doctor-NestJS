import { Types } from 'mongoose';
import { toStoredNotificationPayload } from './notification-payload.mapper';

describe('toStoredNotificationPayload', () => {
  it('serializes lean Mongo ObjectId values without losing method context', () => {
    const id = new Types.ObjectId('64b000000000000000000001');

    const payload = toStoredNotificationPayload({
      _id: id,
      type: 'APPOINTMENT_SUCCESS',
      recipientEmail: 'patient@example.com',
      recipientRole: 'PATIENT',
      title: 'Đặt lịch khám thành công',
      message: 'Bạn có thông báo lịch khám mới.',
      titleKey: 'notification.patient.appointmentSuccess.title',
      messageKey: 'notification.patient.appointmentSuccess.message',
      data: { appointmentDate: 1700000000000 },
      isRead: false,
      createdAt: new Date(1700000001000),
    });

    expect(payload).toMatchObject({
      _id: '64b000000000000000000001',
      recipientEmail: 'patient@example.com',
      recipientRole: 'PATIENT',
      data: { appointmentDate: 1700000000000 },
      createdAt: 1700000001000,
    });
  });
});
