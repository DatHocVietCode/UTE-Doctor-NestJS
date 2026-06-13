import { AppointmentStatus } from "../enums/Appointment-status.enum";

// Statuses for which an appointment actively occupies a concrete doctor/date/slot.
export const ACTIVE_APPOINTMENT_STATUSES = [
    AppointmentStatus.PENDING,
    AppointmentStatus.CONFIRMED,
] as const;

// Partial filter for the unique { doctorId, date, timeSlot } index.
//
// In addition to the active-status scope, this requires `doctorId` AND `timeSlot`
// to exist. Broad (unassigned-doctor) appointments have null doctor/slot; without
// these existence checks they would all collide on a single null key in a unique
// index. With them, many broad PENDING appointments coexist, while concrete
// double-bookings of the same doctor/date/slot are still rejected.
//
// Lives in its own decorator-free module so it can be imported by both the schema
// and unit tests (the schema file itself cannot be imported under ts-jest because
// `isolatedModules` strips the decorator metadata that @Prop needs).
export const ACTIVE_DOCTOR_SLOT_PARTIAL_FILTER = {
    appointmentStatus: { $in: [...ACTIVE_APPOINTMENT_STATUSES] },
    doctorId: { $exists: true },
    timeSlot: { $exists: true },
};
