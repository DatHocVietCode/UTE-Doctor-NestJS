jest.mock('./schemas/visit.schema', () => ({ Visit: class Visit {} }));
jest.mock('src/appointment/schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('src/timeslot/schemas/timeslot-log.schema', () => ({ TimeSlotLog: class TimeSlotLog {} }));
jest.mock('src/patient/schema/patient.schema', () => ({ Patient: class Patient {} }));
jest.mock('src/patient/medical-encounter.service', () => ({
  MedicalEncounterService: class MedicalEncounterService {},
}));
jest.mock('src/doctor/schema/doctor.schema', () => ({ Doctor: class Doctor {} }));
jest.mock('src/profile/schema/profile.schema', () => ({ Profile: class Profile {} }));

import { BadRequestException } from '@nestjs/common';
import { AppointmentStatus } from 'src/appointment/enums/Appointment-status.enum';
import { VisitStatus } from './enums/visit-status.enum';
import { VisitService } from './visit.service';

function createService(appointmentStatus: AppointmentStatus) {
  const visit = {
    appointmentId: '64d000000000000000000002',
    status: VisitStatus.CREATED,
    save: jest.fn().mockResolvedValue(undefined),
  };

  const visitModel = {
    findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(visit) }),
  };

  const appointmentModel = {
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ appointmentStatus }),
        }),
      }),
    }),
  };

  const service = new VisitService(
    { emit: jest.fn() } as any,
    visitModel as any,
    appointmentModel as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  return { service, visit };
}

describe('VisitService.checkInVisit appointment status validation', () => {
  it('rejects broad appointments before assignment confirmation', async () => {
    const { service } = createService(AppointmentStatus.PENDING);

    await expect(service.checkInVisit('visit-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows check-in after assignment confirms the appointment', async () => {
    const { service, visit } = createService(AppointmentStatus.CONFIRMED);

    const result = await service.checkInVisit('visit-1');

    expect(result.status).toBe(VisitStatus.CHECKED_IN);
    expect(visit.save).toHaveBeenCalled();
  });
});
