export enum VisitStatus {
  CREATED = 'CREATED',
  CHECKED_IN = 'CHECKED_IN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  // Terminal: patient never checked in and the appointment lapsed (see AppointmentStatus.NO_SHOW).
  NO_SHOW = 'NO_SHOW',
}
