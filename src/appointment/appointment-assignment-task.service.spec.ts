// Schema files cannot be imported under ts-jest (isolatedModules strips the
// decorator metadata @Prop needs), so mock every schema the service pulls in.
jest.mock('./schemas/appointment-assignment-task.schema', () => ({
  AppointmentAssignmentTask: class AppointmentAssignmentTask {},
}));
jest.mock('./schemas/appointment.schema', () => ({ Appointment: class Appointment {} }));
jest.mock('./schemas/appointment-enriched', () => ({
  buildEnrichedAppointmentPayload: jest.fn(() => ({})),
}));
jest.mock('src/timeslot/schemas/timeslot-log.schema', () => ({ TimeSlotLog: class TimeSlotLog {} }));
jest.mock('src/shift/schema/shift.schema', () => ({ Shift: class Shift {} }));
jest.mock('src/doctor/schema/doctor.schema', () => ({ Doctor: class Doctor {} }));
jest.mock('src/patient/schema/patient.schema', () => ({ Patient: class Patient {} }));

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleEnum } from 'src/common/enum/role.enum';
import { RoleGuard } from 'src/common/guards/role.guard';
import { AppointmentAssignmentTaskController } from './appointment-assignment-task.controller';
import { AppointmentAssignmentTaskService } from './appointment-assignment-task.service';
import { AssignmentTaskStatus } from './enums/assignment-task-status.enum';

const taskId = '64c000000000000000000001';
const receptionistId = '64c000000000000000000002';
const otherReceptionistId = '64c000000000000000000003';
const appointmentId = '64c000000000000000000004';

function makeModel(overrides: Record<string, jest.Mock> = {}) {
  // find().sort().skip().limit().lean() chain.
  const leanResult = jest.fn().mockResolvedValue([]);
  const chain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: leanResult,
  };
  return {
    find: jest.fn().mockReturnValue(chain),
    countDocuments: jest.fn().mockResolvedValue(0),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    ...overrides,
    __chain: chain,
  } as any;
}

function makeRedis(overrides: Record<string, jest.Mock> = {}) {
  return {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

function makeService(model: any, redis: any = makeRedis()) {
  // Only taskModel (1st) and redisService (7th) are exercised by these specs.
  return new AppointmentAssignmentTaskService(
    model,
    undefined as any,
    undefined as any,
    undefined as any,
    undefined as any,
    undefined as any,
    redis,
    undefined as any,
  );
}

function queryOne(value: any) {
  return {
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

const taskLockKey = `assignment-task:${taskId}:lock`;
const taskLockValue = `receptionist:${receptionistId}`;

describe('AppointmentAssignmentTaskService', () => {
  describe('listTasks', () => {
    it('defaults to PENDING status and paginates', async () => {
      const items = [{ _id: taskId, status: AssignmentTaskStatus.PENDING }];
      const model = makeModel();
      model.__chain.lean.mockResolvedValue(items);
      model.countDocuments.mockResolvedValue(1);
      const service = makeService(model);

      const result = await service.listTasks({});

      expect(model.find).toHaveBeenCalledWith({ status: AssignmentTaskStatus.PENDING });
      expect(model.__chain.sort).toHaveBeenCalledWith({ createdAt: 1 });
      expect(result.code).toBe('SUCCESS');
      expect(result.data.items).toBe(items);
      expect(result.data.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });

    it('filters by specialty and honors page/limit', async () => {
      const model = makeModel();
      const service = makeService(model);

      await service.listTasks({ status: AssignmentTaskStatus.ASSIGNED, specialty: 'cardio', page: 2, limit: 5 });

      expect(model.find).toHaveBeenCalledWith({ status: AssignmentTaskStatus.ASSIGNED, specialty: 'cardio' });
      expect(model.__chain.skip).toHaveBeenCalledWith(5);
      expect(model.__chain.limit).toHaveBeenCalledWith(5);
    });
  });

  describe('getTaskDetail', () => {
    it('returns the task when found', async () => {
      const task = { _id: taskId, status: AssignmentTaskStatus.PENDING };
      const model = makeModel({ findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(task) }) });
      const service = makeService(model);

      const result = await service.getTaskDetail(taskId);
      expect(result.data).toBe(task);
    });

    it('throws TASK_NOT_FOUND when missing', async () => {
      const model = makeModel({ findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
      const service = makeService(model);

      await expect(service.getTaskDetail(taskId)).rejects.toMatchObject({
        response: { data: { blockedReason: 'TASK_NOT_FOUND' } },
      });
    });

    it('throws TASK_NOT_FOUND for an invalid id', async () => {
      const model = makeModel();
      const service = makeService(model);
      await expect(service.getTaskDetail('not-an-id')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('acceptTask', () => {
    it('atomically accepts a PENDING task', async () => {
      const updated = {
        _id: { toString: () => taskId },
        status: AssignmentTaskStatus.ASSIGNED,
        acceptedByReceptionistId: { toString: () => receptionistId },
        acceptedAt: 123,
      };
      const model = makeModel({ findOneAndUpdate: jest.fn().mockResolvedValue(updated) });
      const service = makeService(model);

      const result = await service.acceptTask(taskId, receptionistId);

      const [filter, update, options] = model.findOneAndUpdate.mock.calls[0];
      expect(filter).toEqual({ _id: taskId, status: AssignmentTaskStatus.PENDING });
      expect(update.$set.status).toBe(AssignmentTaskStatus.ASSIGNED);
      expect(update.$set.acceptedByReceptionistId.toString()).toBe(receptionistId);
      expect(update.$push.history).toMatchObject({ to: AssignmentTaskStatus.ASSIGNED });
      expect(options).toEqual({ new: true });
      expect(result.data.status).toBe(AssignmentTaskStatus.ASSIGNED);
    });

    it('lets only the first of two concurrent accepts win', async () => {
      const updated = {
        _id: { toString: () => taskId },
        status: AssignmentTaskStatus.ASSIGNED,
        acceptedByReceptionistId: { toString: () => receptionistId },
        acceptedAt: 123,
      };
      // First accept wins; second sees null and the task already ASSIGNED.
      const model = makeModel({
        findOneAndUpdate: jest.fn().mockResolvedValueOnce(updated).mockResolvedValueOnce(null),
        findById: jest
          .fn()
          .mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ status: AssignmentTaskStatus.ASSIGNED }) }) }),
      });
      const service = makeService(model);

      await expect(service.acceptTask(taskId, receptionistId)).resolves.toMatchObject({ code: 'SUCCESS' });
      await expect(service.acceptTask(taskId, otherReceptionistId)).rejects.toMatchObject({
        response: { data: { blockedReason: 'TASK_ALREADY_ACCEPTED' } },
      });
    });

    it('throws TASK_NOT_PENDING when the task is in another state', async () => {
      const model = makeModel({
        findOneAndUpdate: jest.fn().mockResolvedValue(null),
        findById: jest
          .fn()
          .mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ status: AssignmentTaskStatus.COMPLETED }) }) }),
      });
      const service = makeService(model);

      await expect(service.acceptTask(taskId, receptionistId)).rejects.toMatchObject({
        response: { data: { blockedReason: 'TASK_NOT_PENDING' } },
      });
    });

    it('throws TASK_NOT_FOUND when the task does not exist', async () => {
      const model = makeModel({
        findOneAndUpdate: jest.fn().mockResolvedValue(null),
        findById: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) }),
      });
      const service = makeService(model);

      await expect(service.acceptTask(taskId, receptionistId)).rejects.toMatchObject({
        response: { data: { blockedReason: 'TASK_NOT_FOUND' } },
      });
    });

    it('acquires and releases the task lock around a successful accept', async () => {
      const updated = {
        _id: { toString: () => taskId },
        status: AssignmentTaskStatus.ASSIGNED,
        acceptedByReceptionistId: { toString: () => receptionistId },
        acceptedAt: 123,
      };
      const model = makeModel({ findOneAndUpdate: jest.fn().mockResolvedValue(updated) });
      const redis = makeRedis();
      const service = makeService(model, redis);

      await service.acceptTask(taskId, receptionistId);

      expect(redis.acquireLock).toHaveBeenCalledWith(taskLockKey, taskLockValue, expect.any(Number));
      // Release uses the owner-scoped lock value, so it can never delete another owner's lock.
      expect(redis.releaseLock).toHaveBeenCalledWith(taskLockKey, taskLockValue);
    });

    it('rejects with TASK_LOCK_HELD when another receptionist holds the task lock', async () => {
      const model = makeModel();
      const redis = makeRedis({ acquireLock: jest.fn().mockResolvedValue(false) });
      const service = makeService(model, redis);

      await expect(service.acceptTask(taskId, receptionistId)).rejects.toMatchObject({
        response: { data: { blockedReason: 'TASK_LOCK_HELD' } },
      });
      // Never touched the DB and never released a lock it did not own.
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
      expect(redis.releaseLock).not.toHaveBeenCalled();
    });

    it('releases the task lock even after a handled failure', async () => {
      const model = makeModel({
        findOneAndUpdate: jest.fn().mockResolvedValue(null),
        findById: jest
          .fn()
          .mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ status: AssignmentTaskStatus.COMPLETED }) }) }),
      });
      const redis = makeRedis();
      const service = makeService(model, redis);

      await expect(service.acceptTask(taskId, receptionistId)).rejects.toMatchObject({
        response: { data: { blockedReason: 'TASK_NOT_PENDING' } },
      });
      expect(redis.releaseLock).toHaveBeenCalledWith(taskLockKey, taskLockValue);
    });
  });

  describe('releaseTask', () => {
    function modelForRelease(task: any, updated: any = { _id: { toString: () => taskId }, status: AssignmentTaskStatus.PENDING }) {
      return makeModel({
        findById: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(task) }) }),
        findOneAndUpdate: jest.fn().mockResolvedValue(updated),
      });
    }

    it('releases a task accepted by the same receptionist', async () => {
      const task = {
        status: AssignmentTaskStatus.ASSIGNED,
        acceptedByReceptionistId: { toString: () => receptionistId },
      };
      const model = modelForRelease(task);
      const service = makeService(model);

      const result = await service.releaseTask(taskId, receptionistId, 'shift end');

      const [filter, update] = model.findOneAndUpdate.mock.calls[0];
      expect(filter.status).toBe(AssignmentTaskStatus.ASSIGNED);
      expect(update.$set.status).toBe(AssignmentTaskStatus.PENDING);
      expect(update.$unset).toEqual({ acceptedByReceptionistId: '', acceptedAt: '' });
      expect(result.data.status).toBe(AssignmentTaskStatus.PENDING);
    });

    it('blocks release by a non-owner', async () => {
      const task = {
        status: AssignmentTaskStatus.ASSIGNED,
        acceptedByReceptionistId: { toString: () => receptionistId },
      };
      const model = modelForRelease(task);
      const service = makeService(model);

      await expect(service.releaseTask(taskId, otherReceptionistId)).rejects.toMatchObject({
        response: { data: { blockedReason: 'TASK_NOT_OWNED' } },
      });
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('blocks release when the task is not ASSIGNED', async () => {
      const task = { status: AssignmentTaskStatus.PENDING, acceptedByReceptionistId: undefined };
      const model = modelForRelease(task);
      const service = makeService(model);

      await expect(service.releaseTask(taskId, receptionistId)).rejects.toMatchObject({
        response: { data: { blockedReason: 'TASK_NOT_ASSIGNED' } },
      });
    });

    it('throws TASK_NOT_FOUND when the task is missing', async () => {
      const model = modelForRelease(null);
      const service = makeService(model);
      await expect(service.releaseTask(taskId, receptionistId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createAssignmentTaskAfterDepositSuccess', () => {
    it('creates one active task with a deposit-paid deadline', async () => {
      const deadlineAt = 1780201800000;
      const createdTask = {
        _id: { toString: () => taskId },
        deadlineAt,
        patientEmail: 'patient@example.com',
        specialty: 'cardiology',
        reasonForAppointment: 'chest pain',
      };
      const model = makeModel({
        findOne: jest.fn().mockReturnValue(queryOne(null)),
        create: jest.fn().mockResolvedValue([createdTask]),
      });
      const service = makeService(model);

      const result = await service.createAssignmentTaskAfterDepositSuccess({
        appointmentId,
        deadlineAt,
        specialty: 'cardiology',
        reasonForAppointment: 'chest pain',
        patientEmail: 'patient@example.com',
      });

      expect(result).toMatchObject({ taskId, appointmentId, deadlineAt, created: true });
      expect(model.create).toHaveBeenCalledTimes(1);
      const [docs] = model.create.mock.calls[0];
      expect(docs[0]).toMatchObject({
        status: AssignmentTaskStatus.PENDING,
        deadlineAt,
        specialty: 'cardiology',
        reasonForAppointment: 'chest pain',
        patientEmail: 'patient@example.com',
        priority: 'NORMAL',
      });
      expect(docs[0].appointmentId.toString()).toBe(appointmentId);
    });

    it('returns the existing active task instead of creating a duplicate', async () => {
      const existingTask = {
        _id: { toString: () => taskId },
        deadlineAt: 1780201800000,
        patientEmail: 'patient@example.com',
        specialty: 'cardiology',
        reasonForAppointment: 'chest pain',
      };
      const model = makeModel({
        findOne: jest.fn().mockReturnValue(queryOne(existingTask)),
        create: jest.fn(),
      });
      const service = makeService(model);

      const result = await service.createAssignmentTaskAfterDepositSuccess({
        appointmentId,
        deadlineAt: 1780201800000,
      });

      expect(result).toMatchObject({ taskId, appointmentId, created: false });
      expect(model.create).not.toHaveBeenCalled();
    });
  });
});

// Role enforcement is provided by the shared RoleGuard + @Roles metadata on the
// controller. These tests confirm wrong roles are rejected and right roles pass.
describe('AppointmentAssignmentTaskController role enforcement', () => {
  const reflector = new Reflector();
  const guard = new RoleGuard(reflector);

  function contextFor(handler: (...args: any[]) => any, role?: RoleEnum) {
    return {
      getHandler: () => handler,
      getClass: () => AppointmentAssignmentTaskController,
      switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
    } as any;
  }

  const proto = AppointmentAssignmentTaskController.prototype;

  it('rejects a PATIENT from listing the queue', () => {
    expect(() => guard.canActivate(contextFor(proto.listTasks, RoleEnum.PATIENT))).toThrow(ForbiddenException);
  });

  it('allows RECEPTIONIST and ADMIN to list the queue', () => {
    expect(guard.canActivate(contextFor(proto.listTasks, RoleEnum.RECEPTIONIST))).toBe(true);
    expect(guard.canActivate(contextFor(proto.listTasks, RoleEnum.ADMIN))).toBe(true);
  });

  it('restricts accept/release to RECEPTIONIST only (ADMIN and others rejected)', () => {
    expect(guard.canActivate(contextFor(proto.acceptTask, RoleEnum.RECEPTIONIST))).toBe(true);
    expect(() => guard.canActivate(contextFor(proto.acceptTask, RoleEnum.ADMIN))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor(proto.releaseTask, RoleEnum.DOCTOR))).toThrow(ForbiddenException);
  });
});
