import { MailService } from './mail.service';

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
