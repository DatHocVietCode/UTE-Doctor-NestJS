import { AppointmentCancelledNotificationHandler } from './handlers/appointment-cancelled-notification.handler';
import { AppointmentRescheduledNotificationHandler } from './handlers/appointment-rescheduled-notification.handler';
import { AppointmentSuccessNotificationHandler } from './handlers/appointment-success-notification.handler';
import { PaymentSuccessNotificationHandler } from './handlers/payment-success-notification.handler';
import { AppointmentNotificationListener } from './listenners/appointment.notify.listenner';
import { PaymentNotificationListener } from './listenners/payment.notify.listenner';

function createAppointmentPayload() {
  return {
    _id: 'appt-1',
    patientEmail: 'Patient@X.com',
    doctorEmail: 'Doctor@X.com',
    doctorName: 'Dr Smith',
    date: 1700000000000,
    timeSlot: 'slot-1',
    hospitalName: 'UTE Clinic',
    serviceType: 'SPECIALTY',
    paymentMethod: 'VNPAY',
    amount: 100000,
  } as any;
}

function createHandlerMocks(storeResult = true) {
  const write = { storeIfNotExists: jest.fn().mockResolvedValue(storeResult) };
  const redis = { publish: jest.fn().mockResolvedValue(undefined) };
  const eventEmitter = {
    emitAsync: jest.fn().mockResolvedValue(['09:00-09:30']),
  };

  return { write, redis, eventEmitter };
}

describe('notification audience ownership', () => {
  it('booking success publishes independent patient and doctor jobs', async () => {
    const publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const listener = new AppointmentNotificationListener(publisher as any);
    const payload = createAppointmentPayload();

    await listener.handlePatientNotification(payload);
    await listener.handleDoctorNotification(payload);

    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(publisher.publish.mock.calls[0][0]).toMatchObject({
      type: 'APPOINTMENT_SUCCESS',
      recipientEmail: 'patient@x.com',
      recipientRole: 'PATIENT',
      idempotencyKey: 'APPOINTMENT_SUCCESS:appt-1:patient@x.com',
    });
    expect(publisher.publish.mock.calls[1][0]).toMatchObject({
      type: 'APPOINTMENT_SUCCESS',
      recipientEmail: 'doctor@x.com',
      recipientRole: 'DOCTOR',
      idempotencyKey: 'APPOINTMENT_SUCCESS:appt-1:doctor@x.com',
    });
  });

  it('booking success stores patient and doctor role-specific content', async () => {
    const { write, redis, eventEmitter } = createHandlerMocks();
    const handler = new AppointmentSuccessNotificationHandler(
      write as any,
      redis as any,
      eventEmitter as any,
    );
    const payload = createAppointmentPayload();

    await handler.handle(payload, {
      recipientEmail: 'patient@x.com',
      recipientRole: 'PATIENT',
      createdAt: 1700000000000,
      idempotencyKey: 'APPOINTMENT_SUCCESS:appt-1:patient@x.com',
    });
    await handler.handle(payload, {
      recipientEmail: 'doctor@x.com',
      recipientRole: 'DOCTOR',
      createdAt: 1700000000001,
      idempotencyKey: 'APPOINTMENT_SUCCESS:appt-1:doctor@x.com',
    });

    const patientRow = write.storeIfNotExists.mock.calls[0][0];
    const doctorRow = write.storeIfNotExists.mock.calls[1][0];
    expect(patientRow).toMatchObject({
      recipientEmail: 'patient@x.com',
      recipientRole: 'PATIENT',
      title: 'Đặt lịch khám thành công',
      details: expect.objectContaining({ recipientRole: 'PATIENT' }),
    });
    expect(doctorRow).toMatchObject({
      recipientEmail: 'doctor@x.com',
      recipientRole: 'DOCTOR',
      title: 'Lịch khám mới được gán cho bạn',
      details: expect.objectContaining({ recipientRole: 'DOCTOR' }),
    });
    expect(patientRow.message).toContain('của bạn');
    expect(doctorRow.message).toContain('với bệnh nhân Patient@X.com');
    expect(patientRow.message).not.toBe(doctorRow.message);
  });

  it('cancel appointment creates patient and doctor jobs with unique keys', async () => {
    const publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const listener = new AppointmentNotificationListener(publisher as any);

    await listener.handlePatientAppointmentCancelled({
      appointmentId: 'appt-1',
      patientEmail: 'Patient@X.com',
      doctorEmail: 'Doctor@X.com',
      date: '2026-06-15',
      timeSlot: 'slot-1',
      reason: 'patient request',
    });

    const jobs = publisher.publish.mock.calls.map((call) => call[0]);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      recipientEmail: 'patient@x.com',
      recipientRole: 'PATIENT',
      idempotencyKey: 'APPOINTMENT_CANCELLED:appt-1:patient@x.com',
    });
    expect(jobs[1]).toMatchObject({
      recipientEmail: 'doctor@x.com',
      recipientRole: 'DOCTOR',
      idempotencyKey: 'APPOINTMENT_CANCELLED:appt-1:doctor@x.com',
    });
  });

  it('cancel appointment stores patient and doctor role-specific content', async () => {
    const { write, redis, eventEmitter } = createHandlerMocks();
    const handler = new AppointmentCancelledNotificationHandler(
      write as any,
      redis as any,
      eventEmitter as any,
    );
    const payload = {
      appointmentId: 'appt-1',
      patientEmail: 'Patient@X.com',
      doctorEmail: 'Doctor@X.com',
      date: '2026-06-15',
      timeSlot: 'slot-1',
      reason: 'patient request',
    };

    await handler.handle(payload, {
      recipientEmail: 'patient@x.com',
      recipientRole: 'PATIENT',
      createdAt: 1700000000000,
      idempotencyKey: 'APPOINTMENT_CANCELLED:appt-1:patient@x.com',
    });
    await handler.handle(payload, {
      recipientEmail: 'doctor@x.com',
      recipientRole: 'DOCTOR',
      createdAt: 1700000000001,
      idempotencyKey: 'APPOINTMENT_CANCELLED:appt-1:doctor@x.com',
    });

    const patientRow = write.storeIfNotExists.mock.calls[0][0];
    const doctorRow = write.storeIfNotExists.mock.calls[1][0];
    expect(patientRow.title).toBe('Lịch khám của bạn đã bị hủy');
    expect(doctorRow.title).toBe('Bệnh nhân đã hủy lịch khám');
    expect(patientRow.message).not.toBe(doctorRow.message);
  });

  it('reschedule stores patient and doctor role-specific content', async () => {
    const { write, redis, eventEmitter } = createHandlerMocks();
    const handler = new AppointmentRescheduledNotificationHandler(
      write as any,
      redis as any,
      eventEmitter as any,
    );
    const payload = {
      appointmentId: 'appt-1',
      patientEmail: 'Patient@X.com',
      doctorEmail: 'Doctor@X.com',
      oldScheduledAt: 1700000000000,
      newScheduledAt: 1700003600000,
      newTimeSlotId: 'slot-2',
      hospitalName: 'UTE Clinic',
    };

    await handler.handle(payload, {
      recipientEmail: 'patient@x.com',
      recipientRole: 'PATIENT',
      createdAt: 1700000000000,
      idempotencyKey: 'APPOINTMENT_RESCHEDULED:appt-1:patient@x.com',
    });
    await handler.handle(payload, {
      recipientEmail: 'doctor@x.com',
      recipientRole: 'DOCTOR',
      createdAt: 1700000000001,
      idempotencyKey: 'APPOINTMENT_RESCHEDULED:appt-1:doctor@x.com',
    });

    const patientRow = write.storeIfNotExists.mock.calls[0][0];
    const doctorRow = write.storeIfNotExists.mock.calls[1][0];
    expect(patientRow.title).toBe('Lịch khám của bạn đã được đổi lịch');
    expect(doctorRow.title).toBe('Lịch khám đã được đổi lịch');
    expect(doctorRow.message).toContain('với bệnh nhân Patient@X.com');
    expect(patientRow.message).not.toBe(doctorRow.message);
  });

  it('payment success publishes and stores a patient-only notification', async () => {
    const publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const eventEmitter = {
      emitAsync: jest
        .fn()
        .mockResolvedValue([{ patientEmail: 'Patient@X.com' }]),
    };
    const listener = new PaymentNotificationListener(
      publisher as any,
      eventEmitter as any,
    );

    await listener.handlePaymentUpdate({
      orderId: 'appt-1',
      status: 'COMPLETED',
    });

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(publisher.publish.mock.calls[0][0]).toMatchObject({
      type: 'PAYMENT_SUCCESS',
      recipientEmail: 'patient@x.com',
      recipientRole: 'PATIENT',
    });

    const { write, redis } = createHandlerMocks();
    const handler = new PaymentSuccessNotificationHandler(
      write as any,
      redis as any,
    );

    await handler.handle(
      { orderId: 'appt-1', status: 'COMPLETED' },
      {
        recipientEmail: 'patient@x.com',
        recipientRole: 'PATIENT',
        createdAt: 1700000000000,
        idempotencyKey: 'PAYMENT_SUCCESS:appt-1:patient@x.com',
      },
    );

    expect(write.storeIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: 'patient@x.com',
        recipientRole: 'PATIENT',
        title: 'Thanh toán thành công',
        details: expect.objectContaining({ recipientRole: 'PATIENT' }),
      }),
    );
  });

  it('does not emit realtime for duplicate notification records', async () => {
    const { write, redis, eventEmitter } = createHandlerMocks(false);
    const handler = new AppointmentSuccessNotificationHandler(
      write as any,
      redis as any,
      eventEmitter as any,
    );

    await handler.handle(createAppointmentPayload(), {
      recipientEmail: 'patient@x.com',
      recipientRole: 'PATIENT',
      createdAt: 1700000000000,
      idempotencyKey: 'APPOINTMENT_SUCCESS:appt-1:patient@x.com',
    });

    expect(write.storeIfNotExists).toHaveBeenCalledTimes(1);
    expect(redis.publish).not.toHaveBeenCalled();
  });
});
