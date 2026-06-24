import type { AppointmentDoctorAssignedDto } from './dto/notification-payload.dto';
import { buildAppointmentDoctorAssignedNotification } from './notification-template.helper';

// 2026-06-22T02:30:00Z === 09:30 / 03:00:00Z === 10:00 in Asia/Ho_Chi_Minh (UTC+7).
const SCHEDULED_AT = Date.UTC(2026, 5, 22, 2, 30, 0);
const START_TIME = Date.UTC(2026, 5, 22, 2, 30, 0);
const END_TIME = Date.UTC(2026, 5, 22, 3, 0, 0);

function makePayload(
  overrides: Partial<AppointmentDoctorAssignedDto> = {},
): AppointmentDoctorAssignedDto {
  return {
    appointmentId: 'appt-1',
    doctorId: 'doc-1',
    timeSlotId: 'slot-1',
    scheduledAt: SCHEDULED_AT,
    patientEmail: 'patient@x.com',
    doctorName: 'Trần Văn A',
    hospitalName: 'Bệnh viện UTE',
    startTime: START_TIME,
    endTime: END_TIME,
    serviceType: 'KHAM_DICH_VU',
    specialty: 'cardiology',
    ...overrides,
  };
}

describe('buildAppointmentDoctorAssignedNotification', () => {
  it('builds a readable message with doctor name, time range and location', () => {
    const result = buildAppointmentDoctorAssignedNotification(makePayload());

    expect(result.title).toBe('Bác sĩ đã được phân công');
    expect(result.message).toBe(
      'Bác sĩ Trần Văn A sẽ khám cho bạn lúc 09:30–10:00 22/06/2026 tại Bệnh viện UTE.',
    );
  });

  it('keeps epoch (not formatted strings) in the structured data', () => {
    const result = buildAppointmentDoctorAssignedNotification(makePayload());

    expect(result.data.scheduledAt).toBe(SCHEDULED_AT);
    expect(result.data.startTime).toBe(START_TIME);
    expect(result.data.endTime).toBe(END_TIME);
    expect(result.data.doctorName).toBe('Trần Văn A');
    expect(result.data.hospitalName).toBe('Bệnh viện UTE');
    expect(result.data.specialty).toBe('cardiology');
  });

  it('never emits a raw epoch number in the human-facing message', () => {
    const result = buildAppointmentDoctorAssignedNotification(makePayload());
    expect(result.message).not.toContain(String(SCHEDULED_AT));
  });

  it('falls back to scheduledAt when start/end window is missing', () => {
    const result = buildAppointmentDoctorAssignedNotification(
      makePayload({ startTime: undefined, endTime: undefined }),
    );
    expect(result.message).toBe(
      'Bác sĩ Trần Văn A sẽ khám cho bạn lúc 09:30 22/06/2026 tại Bệnh viện UTE.',
    );
  });

  it('degrades gracefully when doctor name and location are missing', () => {
    const result = buildAppointmentDoctorAssignedNotification(
      makePayload({ doctorName: undefined, hospitalName: undefined }),
    );
    expect(result.message).toBe('Bác sĩ sẽ khám cho bạn lúc 09:30–10:00 22/06/2026.');
    expect(result.message).not.toContain('undefined');
  });

  it('omits the time clause entirely when no time is known', () => {
    const result = buildAppointmentDoctorAssignedNotification(
      makePayload({
        scheduledAt: undefined as unknown as number,
        startTime: undefined,
        endTime: undefined,
      }),
    );
    expect(result.message).toBe('Bác sĩ Trần Văn A sẽ khám cho bạn tại Bệnh viện UTE.');
    expect(result.message).not.toContain('lúc');
  });
});
