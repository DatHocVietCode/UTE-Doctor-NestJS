export const APPOINTMENT_BOOKING_GUIDE_SOURCE =
  'appointment-booking-guide' as const;
export const APPOINTMENT_BOOKING_GUIDE_SCOPE =
  'APPOINTMENT_BOOKING_GUIDE' as const;

export type AppointmentBookingGuideSource =
  typeof APPOINTMENT_BOOKING_GUIDE_SOURCE;

export type AppointmentBookingGuideScope =
  typeof APPOINTMENT_BOOKING_GUIDE_SCOPE;

export interface AppointmentBookingGuideResponse {
  answer: string;
  source: AppointmentBookingGuideSource;
  scope: AppointmentBookingGuideScope;
  model?: string;
  error?: string;
}
