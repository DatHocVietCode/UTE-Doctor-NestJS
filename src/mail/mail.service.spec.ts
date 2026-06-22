import { MailService } from './mail.service';

// 2026-06-22T02:30:00Z === 09:30 / 03:00:00Z === 10:00 in Asia/Ho_Chi_Minh (UTC+7).
const SCHEDULED_AT = Date.UTC(2026, 5, 22, 2, 30, 0);
const START_TIME = Date.UTC(2026, 5, 22, 2, 30, 0);
const END_TIME = Date.UTC(2026, 5, 22, 3, 0, 0);

function makeMailService(slotName = 'Ca sáng') {
  const mailerService = { sendMail: jest.fn().mockResolvedValue(undefined) };
  const eventEmitter = {
    emitAsync: jest.fn().mockResolvedValue([slotName]),
  };
  const service = new MailService(mailerService as any, eventEmitter as any);
  return { service, mailerService, eventEmitter };
}

function bookingPayload(overrides: Record<string, any> = {}) {
  return {
    patientEmail: 'patient@x.com',
    patientName: 'Nguyễn Văn B',
    doctorName: 'Trần Văn A',
    hospitalName: 'Bệnh viện UTE',
    serviceType: 'KHAM_DICH_VU',
    assignmentStatus: 'ASSIGNED',
    scheduledAt: SCHEDULED_AT,
    startTime: START_TIME,
    endTime: END_TIME,
    date: SCHEDULED_AT,
    timeSlot: '64d000000000000000000005',
    ...overrides,
  };
}

describe('MailService.sendPatientBookingSuccessMail', () => {
  it('formats the appointment time from epoch and never prints a raw epoch', async () => {
    const { service, mailerService } = makeMailService();

    await service.sendPatientBookingSuccessMail(bookingPayload() as any);

    expect(mailerService.sendMail).toHaveBeenCalledTimes(1);
    const sent = mailerService.sendMail.mock.calls[0][0];
    expect(sent.html).toContain('09:30–10:00 22/06/2026');
    expect(sent.html).toContain('Trần Văn A');
    expect(sent.html).toContain('Bệnh viện UTE');
    expect(sent.html).toContain('Khám dịch vụ');
    // No raw epoch leaks into the body.
    expect(sent.html).not.toContain(String(SCHEDULED_AT));
  });

  it('uses the "doctor assigned" subject for a broad-appointment assignment', async () => {
    const { service, mailerService } = makeMailService();
    await service.sendPatientBookingSuccessMail(bookingPayload() as any);
    const sent = mailerService.sendMail.mock.calls[0][0];
    expect(sent.subject).toBe(
      'Bác sĩ đã được phân công cho lịch khám của bạn - UTE Doctor',
    );
  });

  it('uses the confirmation subject for a normal (non-broad) booking', async () => {
    const { service, mailerService } = makeMailService();
    await service.sendPatientBookingSuccessMail(
      bookingPayload({ assignmentStatus: 'NONE' }) as any,
    );
    const sent = mailerService.sendMail.mock.calls[0][0];
    expect(sent.subject).toBe('Xác nhận lịch khám - UTE Doctor');
  });

  it('shows a location fallback instead of crashing when hospital is missing', async () => {
    const { service, mailerService } = makeMailService();
    await service.sendPatientBookingSuccessMail(
      bookingPayload({ hospitalName: '' }) as any,
    );
    const sent = mailerService.sendMail.mock.calls[0][0];
    expect(sent.html).toContain('Sẽ được cập nhật');
  });

  it('does not crash when the time-slot lookup fails (still sends the mail)', async () => {
    const { service, mailerService, eventEmitter } = makeMailService();
    eventEmitter.emitAsync.mockRejectedValueOnce(new Error('timeslot down'));

    await expect(
      service.sendPatientBookingSuccessMail(bookingPayload() as any),
    ).resolves.toBeUndefined();

    expect(mailerService.sendMail).toHaveBeenCalledTimes(1);
    const sent = mailerService.sendMail.mock.calls[0][0];
    // Time still rendered from epoch even though the slot label was unavailable.
    expect(sent.html).toContain('09:30–10:00 22/06/2026');
  });
});

describe('MailService assignment-timeout cancellation mail', () => {
  it('uses timeout-specific content instead of patient-cancel wording', async () => {
    const mailerService = { sendMail: jest.fn().mockResolvedValue(undefined) };
    const eventEmitter = {
      emitAsync: jest.fn().mockResolvedValue(['Chua phan cong']),
    };
    const service = new MailService(mailerService as any, eventEmitter as any);

    await service.sendPatientAppointmentCancellationMail({
      patientEmail: 'patient@x.com',
      date: '2026-06-16',
      timeSlot: '',
      reason: 'Tu dong huy do qua han phan cong bac si',
      refundAmount: 100000,
      shouldRefund: true,
      actor: 'SYSTEM',
      reasonCode: 'ASSIGNMENT_TIMEOUT',
    });

    expect(mailerService.sendMail).toHaveBeenCalledTimes(1);
    const sent = mailerService.sendMail.mock.calls[0][0];
    expect(sent.subject).toBe(
      'Thong bao tu dong huy lich kham - UTE Doctor',
    );
    expect(sent.html).toContain('khong the phan cong bac si');
    expect(sent.html).toContain('tu dong huy');
    expect(sent.html).toContain('100000');
    expect(sent.html).not.toMatch(/patient cancelled|benh nhan da huy/i);
  });
});
