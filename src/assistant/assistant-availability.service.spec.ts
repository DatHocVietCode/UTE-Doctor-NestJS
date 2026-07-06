import { AssistantAvailabilityService } from './assistant-availability.service';
import { AvailabilityIntentParser } from './availability-intent.parser';
import { AvailabilityLookupService } from './availability-lookup.service';
import {
  AvailabilityParsedIntent,
  AvailabilitySlot,
  DoctorSummary,
  SpecialtySummary,
} from './availability.types';

const specialties: SpecialtySummary[] = [
  { id: 'spec-derm', name: 'Da liễu' },
  { id: 'spec-cardio', name: 'Tim mạch' },
];
const doctor: DoctorSummary = {
  id: 'doctor-1',
  name: 'Nguyễn Văn A',
  email: 'doctor@example.com',
  specialtyId: 'spec-derm',
  specialtyName: 'Da liễu',
};
const slots: AvailabilitySlot[] = [
  {
    timeSlotId: 'slot-1',
    startTime: '08:00',
    endTime: '08:30',
    label: '08:00 - 08:30',
  },
  {
    timeSlotId: 'slot-2',
    startTime: '09:00',
    endTime: '09:30',
    label: '09:00 - 09:30',
  },
];

const parsedDoctorIntent: AvailabilityParsedIntent = {
  intent: 'DOCTOR_AVAILABILITY',
  doctorName: 'Nguyễn Văn A',
  date: '2026-06-29',
  dateText: 'ngày mai',
  range: 'single_day',
  needsFollowUp: false,
  parser: 'fallback',
};

const createService = (
  parsed: AvailabilityParsedIntent,
  lookupOverrides: Partial<
    Record<keyof AvailabilityLookupService, jest.Mock>
  > = {},
) => {
  const parser = {
    parse: jest.fn(() => parsed),
  } as unknown as AvailabilityIntentParser;

  const lookupMocks = {
    listSpecialties: jest.fn().mockResolvedValue(specialties),
    resolveDoctor: jest.fn().mockResolvedValue({ type: 'single', doctor }),
    resolveSpecialty: jest.fn().mockReturnValue({
      type: 'single',
      specialty: specialties[0],
    }),
    getAvailableSlotsForDoctor: jest.fn().mockResolvedValue({
      allSlots: slots,
      matchingSlots: slots,
    }),
    getAvailabilityForSpecialty: jest
      .fn()
      .mockResolvedValue([{ doctor, availableSlots: slots }]),
    findNearestDoctorAvailability: jest.fn(),
    findNearestSpecialtyAvailability: jest.fn(),
    listDoctorsBySpecialty: jest.fn(),
  };
  const lookup = {
    ...lookupMocks,
    ...lookupOverrides,
  } as unknown as AvailabilityLookupService;

  return {
    service: new AssistantAvailabilityService(parser, lookup),
    parser,
    lookup,
    lookupMocks,
  };
};

describe('AssistantAvailabilityService', () => {
  it('returns real mocked slots for doctor availability', async () => {
    const { service, lookupMocks } = createService(parsedDoctorIntent);

    const response = await service.ask({
      question: 'Bác sĩ Nguyễn Văn A ngày mai trống giờ nào?',
    });

    expect(lookupMocks.getAvailableSlotsForDoctor).toHaveBeenCalledWith(
      'doctor-1',
      '2026-06-29',
      undefined,
    );
    expect(response.answer).toContain('08:00 - 08:30');
    expect(response.answer).toContain('09:00 - 09:30');
    expect(response.data.availableSlots).toEqual(slots);
  });

  it('does not invent slots when a doctor has no availability', async () => {
    const { service } = createService(parsedDoctorIntent, {
      getAvailableSlotsForDoctor: jest.fn().mockResolvedValue({
        allSlots: [],
        matchingSlots: [],
      }),
    });

    const response = await service.ask({
      question: 'Bác sĩ Nguyễn Văn A ngày mai trống giờ nào?',
    });

    expect(response.answer).toContain('chưa có lịch trống');
    expect(response.answer).not.toContain('10:00');
    expect(response.data.availableSlots).toEqual([]);
  });

  it('handles doctor not found', async () => {
    const { service } = createService(parsedDoctorIntent, {
      resolveDoctor: jest.fn().mockResolvedValue({ type: 'not_found' }),
    });

    const response = await service.ask({
      question: 'Bác sĩ Không Có ngày mai trống không?',
    });

    expect(response.answer).toContain('chưa tìm thấy bác sĩ');
    expect(response.data.specialtyOptions).toEqual(specialties);
  });

  it('asks the user to choose when multiple doctors match', async () => {
    const { service } = createService(parsedDoctorIntent, {
      resolveDoctor: jest.fn().mockResolvedValue({
        type: 'multiple',
        doctors: [
          doctor,
          {
            ...doctor,
            id: 'doctor-2',
            name: 'Nguyễn Văn An',
            specialtyName: 'Tim mạch',
          },
        ],
      }),
    });

    const response = await service.ask({
      question: 'Bác sĩ Nguyễn ngày mai trống không?',
    });

    expect(response.answer).toContain('nhiều bác sĩ');
    expect(response.data.doctorOptions).toHaveLength(2);
  });

  it('handles specialty not found', async () => {
    const parsed: AvailabilityParsedIntent = {
      intent: 'SPECIALTY_AVAILABILITY',
      specialtyName: 'Khoa lạ',
      date: '2026-06-29',
      dateText: 'ngày mai',
      range: 'single_day',
      needsFollowUp: false,
      parser: 'fallback',
    };
    const { service } = createService(parsed, {
      resolveSpecialty: jest.fn().mockReturnValue({ type: 'not_found' }),
    });

    const response = await service.ask({
      question: 'Chuyên khoa Khoa lạ ngày mai còn lịch không?',
    });

    expect(response.answer).toContain('chưa tìm thấy chuyên khoa');
    expect(response.data.specialtyOptions).toEqual(specialties);
  });

  it('returns specialty doctors and slots from lookup results only', async () => {
    const parsed: AvailabilityParsedIntent = {
      intent: 'SPECIALTY_AVAILABILITY',
      specialtyName: 'Da liễu',
      date: '2026-06-29',
      dateText: 'ngày mai',
      range: 'single_day',
      needsFollowUp: false,
      parser: 'fallback',
    };
    const { service } = createService(parsed);

    const response = await service.ask({
      question: 'Da liễu ngày mai còn lịch không?',
    });

    expect(response.answer).toContain('Nguyễn Văn A');
    expect(response.answer).toContain('08:00 - 08:30');
    expect(response.answer).not.toContain('10:00');
    expect(response.data.doctors?.[0].availableSlots).toEqual(slots);
  });
});
