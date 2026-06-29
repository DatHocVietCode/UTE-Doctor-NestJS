import { AvailabilityIntentParser } from './availability-intent.parser';
import { SpecialtySummary } from './availability.types';

const specialties: SpecialtySummary[] = [
  { id: 'spec-derm', name: 'Da liễu' },
  { id: 'spec-cardio', name: 'Tim mạch' },
];
const now = new Date('2026-06-28T04:00:00.000Z');

describe('AvailabilityIntentParser', () => {
  const parser = new AvailabilityIntentParser();

  it('extracts doctor and date for doctor availability questions', () => {
    const result = parser.parse('Bác sĩ Nguyễn Văn A ngày mai trống giờ nào?', {
      specialties,
      now,
    });

    expect(result).toMatchObject({
      intent: 'DOCTOR_AVAILABILITY',
      doctorName: 'Nguyễn Văn A',
      date: '2026-06-29',
      dateText: 'ngày mai',
      range: 'single_day',
      needsFollowUp: false,
    });
  });

  it('extracts specialty and date for specialty availability questions', () => {
    const result = parser.parse('Chuyên khoa Da liễu hôm nay còn lịch không?', {
      specialties,
      now,
    });

    expect(result).toMatchObject({
      intent: 'SPECIALTY_AVAILABILITY',
      specialtyName: 'Da liễu',
      date: '2026-06-28',
      dateText: 'hôm nay',
      needsFollowUp: false,
    });
  });

  it('asks for a date when a doctor is present but date is missing', () => {
    const result = parser.parse('Bác sĩ Lan còn lịch không?', {
      specialties,
      now,
    });

    expect(result).toMatchObject({
      intent: 'DOCTOR_AVAILABILITY',
      doctorName: 'Lan',
      needsFollowUp: true,
    });
    expect(result.followUpQuestion).toContain('ngày nào');
  });

  it('asks for a date when a specialty is present but date is missing', () => {
    const result = parser.parse('Da liễu còn lịch không?', {
      specialties,
      now,
    });

    expect(result).toMatchObject({
      intent: 'SPECIALTY_AVAILABILITY',
      specialtyName: 'Da liễu',
      needsFollowUp: true,
    });
    expect(result.followUpQuestion).toContain('ngày nào');
  });

  it('asks for doctor or specialty when only a date is present', () => {
    const result = parser.parse('Ngày mai còn lịch khám không?', {
      specialties,
      now,
    });

    expect(result).toMatchObject({
      intent: 'BROAD_AVAILABILITY',
      date: '2026-06-29',
      needsFollowUp: true,
    });
    expect(result.followUpQuestion).toContain('chuyên khoa hoặc bác sĩ');
  });

  it('marks ambiguous dates for follow-up instead of guessing', () => {
    const result = parser.parse('Bác sĩ Lan bữa sau còn lịch không?', {
      specialties,
      now,
    });

    expect(result).toMatchObject({
      intent: 'DOCTOR_AVAILABILITY',
      doctorName: 'Lan',
      ambiguousDate: true,
      needsFollowUp: true,
    });
    expect(result.followUpQuestion).toContain('nói rõ ngày');
  });
});
