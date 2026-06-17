// The controller imports services that import schemas; mock the schemas so the import
// graph loads under ts-jest. We only exercise role enforcement + delegation here.
jest.mock('src/appointment/schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('src/appointment/schemas/appointment-assignment-task.schema', () => ({ AppointmentAssignmentTask: class AppointmentAssignmentTask {} }));
jest.mock('src/payment/schemas/payment.schema', () => ({ Payment: class Payment {} }));
jest.mock('src/visit/schemas/visit.schema', () => ({ Visit: class Visit {} }));
jest.mock('src/patient/schema/medical-record.schema', () => ({ MedicalEncounter: class MedicalEncounter {} }));
jest.mock('src/billing/billing.schema', () => ({ Billing: class Billing {} }));
jest.mock('src/timeslot/schemas/timeslot-log.schema', () => ({ TimeSlotLog: class TimeSlotLog {} }));
jest.mock('src/wallet/credit/schemas/credit-transaction.schema', () => ({ CreditTransaction: class CreditTransaction {} }));
jest.mock('src/wallet/coin/schemas/coin-transaction.schema', () => ({ CoinTransaction: class CoinTransaction {} }));
jest.mock('src/notification/schemas/notification.schema', () => ({ Notification: class Notification {} }));
jest.mock('src/doctor/schema/doctor.schema', () => ({ Doctor: class Doctor {} }));
jest.mock('src/patient/schema/patient.schema', () => ({ Patient: class Patient {} }));
jest.mock('src/account/schemas/account.schema', () => ({ Account: class Account {} }));

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleEnum } from 'src/common/enum/role.enum';
import { RoleGuard } from 'src/common/guards/role.guard';
import { AdminAppointmentController } from './admin-appointment.controller';

describe('AdminAppointmentController role enforcement (ADMIN-only)', () => {
  const reflector = new Reflector();
  const guard = new RoleGuard(reflector);

  function contextFor(handler: (...args: any[]) => any, role?: RoleEnum) {
    return {
      getHandler: () => handler,
      getClass: () => AdminAppointmentController,
      switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
    } as any;
  }

  const proto = AdminAppointmentController.prototype;

  it('allows ADMIN on every endpoint', () => {
    expect(guard.canActivate(contextFor(proto.list, RoleEnum.ADMIN))).toBe(true);
    expect(guard.canActivate(contextFor(proto.getLifecycle, RoleEnum.ADMIN))).toBe(true);
    expect(guard.canActivate(contextFor(proto.getNodeDetail, RoleEnum.ADMIN))).toBe(true);
  });

  it('rejects RECEPTIONIST, DOCTOR and PATIENT', () => {
    expect(() => guard.canActivate(contextFor(proto.list, RoleEnum.RECEPTIONIST))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor(proto.getLifecycle, RoleEnum.DOCTOR))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor(proto.getNodeDetail, RoleEnum.PATIENT))).toThrow(ForbiddenException);
  });

  it('rejects an unauthenticated request', () => {
    expect(() => guard.canActivate(contextFor(proto.list, undefined))).toThrow(UnauthorizedException);
  });
});

describe('AdminAppointmentController delegation', () => {
  it('delegates to the lifecycle and detail services', async () => {
    const lifecycle = {
      listAppointments: jest.fn().mockResolvedValue({ code: 'SUCCESS' }),
      getLifecycle: jest.fn().mockResolvedValue({ code: 'SUCCESS' }),
    } as any;
    const detail = { getNodeDetail: jest.fn().mockResolvedValue({ code: 'SUCCESS' }) } as any;
    const controller = new AdminAppointmentController(lifecycle, detail);

    await controller.list({ page: 1 } as any);
    await controller.getLifecycle('a1');
    await controller.getNodeDetail('a1', 'n1');

    expect(lifecycle.listAppointments).toHaveBeenCalledWith({ page: 1 });
    expect(lifecycle.getLifecycle).toHaveBeenCalledWith('a1');
    expect(detail.getNodeDetail).toHaveBeenCalledWith('a1', 'n1');
  });
});
