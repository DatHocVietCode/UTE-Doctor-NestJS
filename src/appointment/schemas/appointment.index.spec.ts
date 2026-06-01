import { AppointmentStatus } from '../enums/Appointment-status.enum';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  ACTIVE_DOCTOR_SLOT_PARTIAL_FILTER,
} from './appointment.index';

// Helper mirroring how MongoDB applies a partialFilterExpression: a document is
// covered by the (unique) index only when it matches every clause in the filter.
// This lets us assert the broad-appointment coexistence contract without a live DB.
function matchesPartialFilter(doc: {
  appointmentStatus?: AppointmentStatus;
  doctorId?: unknown;
  timeSlot?: unknown;
}): boolean {
  const f = ACTIVE_DOCTOR_SLOT_PARTIAL_FILTER;
  const statusOk =
    doc.appointmentStatus !== undefined &&
    (f.appointmentStatus.$in as AppointmentStatus[]).includes(doc.appointmentStatus);
  const doctorOk = f.doctorId.$exists ? doc.doctorId !== undefined && doc.doctorId !== null : true;
  const slotOk = f.timeSlot.$exists ? doc.timeSlot !== undefined && doc.timeSlot !== null : true;
  return statusOk && doctorOk && slotOk;
}

describe('Appointment active-slot unique index contract', () => {
  it('scopes uniqueness to active statuses only', () => {
    expect([...ACTIVE_APPOINTMENT_STATUSES]).toEqual([
      AppointmentStatus.PENDING,
      AppointmentStatus.CONFIRMED,
    ]);
    expect(ACTIVE_DOCTOR_SLOT_PARTIAL_FILTER.appointmentStatus.$in).toEqual([
      AppointmentStatus.PENDING,
      AppointmentStatus.CONFIRMED,
    ]);
  });

  it('requires doctorId and timeSlot to exist for the index to apply', () => {
    expect(ACTIVE_DOCTOR_SLOT_PARTIAL_FILTER.doctorId).toEqual({ $exists: true });
    expect(ACTIVE_DOCTOR_SLOT_PARTIAL_FILTER.timeSlot).toEqual({ $exists: true });
  });

  it('does NOT index broad PENDING appointments (null doctor/slot) — they can coexist', () => {
    // Many broad appointments share null doctor/slot; none are covered by the unique
    // index, so they never collide.
    const broadA = { appointmentStatus: AppointmentStatus.PENDING };
    const broadB = { appointmentStatus: AppointmentStatus.PENDING, doctorId: null, timeSlot: null };
    expect(matchesPartialFilter(broadA)).toBe(false);
    expect(matchesPartialFilter(broadB)).toBe(false);
  });

  it('DOES index a concrete active appointment with doctor + slot — duplicates are blocked', () => {
    const concrete = {
      appointmentStatus: AppointmentStatus.CONFIRMED,
      doctorId: 'doctor-1',
      timeSlot: 'slot-1',
    };
    expect(matchesPartialFilter(concrete)).toBe(true);
  });

  it('does not index terminal-status appointments even with doctor + slot', () => {
    for (const status of [
      AppointmentStatus.CANCELLED,
      AppointmentStatus.COMPLETED,
      AppointmentStatus.FAILED,
    ]) {
      expect(
        matchesPartialFilter({ appointmentStatus: status, doctorId: 'd', timeSlot: 's' }),
      ).toBe(false);
    }
  });
});
