export const DOCTOR_AVAILABILITY_SOURCE = 'doctor-availability' as const;
export const DOCTOR_AVAILABILITY_SCOPE = 'DOCTOR_AVAILABILITY' as const;

export type AssistantAvailabilitySource =
  | typeof DOCTOR_AVAILABILITY_SOURCE
  | 'appointment-booking-guide';

export type AssistantAvailabilityScope =
  | typeof DOCTOR_AVAILABILITY_SCOPE
  | 'APPOINTMENT_BOOKING_GUIDE';

export type AvailabilityIntent =
  | 'DOCTOR_AVAILABILITY'
  | 'SPECIALTY_AVAILABILITY'
  | 'DOCTOR_SPECIALTY_AVAILABILITY'
  | 'BROAD_AVAILABILITY'
  | 'INSUFFICIENT_INFORMATION'
  | 'BOOKING_GUIDE'
  | 'OUT_OF_SCOPE_MEDICAL';

export type AvailabilityRange = 'single_day' | 'next_7_days' | 'next_14_days';
export type AvailabilityTimeOfDay = 'morning' | 'afternoon' | 'evening';

export interface SpecialtySummary {
  id: string;
  name: string;
}

export interface DoctorSummary {
  id: string;
  name: string;
  email?: string;
  specialtyId?: string | null;
  specialtyName?: string | null;
}

export interface AvailabilitySlot {
  timeSlotId: string;
  startTime: string;
  endTime: string;
  label: string;
}

export interface DoctorAvailabilitySummary {
  doctor: DoctorSummary;
  availableSlots: AvailabilitySlot[];
}

export interface AvailabilityParsedIntent {
  intent: AvailabilityIntent;
  doctorName?: string;
  specialtyName?: string;
  dateText?: string;
  date?: string;
  timeOfDay?: AvailabilityTimeOfDay;
  range: AvailabilityRange;
  needsFollowUp: boolean;
  followUpQuestion?: string;
  ambiguousDate?: boolean;
  dateInPast?: boolean;
  parser: 'fallback' | 'openai';
}

export interface AssistantAvailabilityData {
  doctor?: DoctorSummary;
  specialty?: SpecialtySummary;
  date?: string;
  dateText?: string;
  timeOfDay?: AvailabilityTimeOfDay;
  availableSlots?: AvailabilitySlot[];
  doctors?: DoctorAvailabilitySummary[];
  alternatives?: string[];
  doctorOptions?: DoctorSummary[];
  specialtyOptions?: SpecialtySummary[];
}

export interface AssistantAvailabilityResponse {
  answer: string;
  source: AssistantAvailabilitySource;
  scope: AssistantAvailabilityScope;
  intent: AvailabilityIntent;
  data: AssistantAvailabilityData;
  parser?: 'fallback' | 'openai';
  error?: string;
}

export type DoctorResolution =
  | { type: 'not_found' }
  | { type: 'multiple'; doctors: DoctorSummary[] }
  | { type: 'single'; doctor: DoctorSummary };

export type SpecialtyResolution =
  | { type: 'not_found' }
  | { type: 'multiple'; specialties: SpecialtySummary[] }
  | { type: 'single'; specialty: SpecialtySummary };
