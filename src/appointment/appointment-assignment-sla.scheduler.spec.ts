jest.mock('./schemas/appointment-assignment-task.schema', () => ({
  AppointmentAssignmentTask: class AppointmentAssignmentTask {},
}));
jest.mock('./appointment.service', () => ({ AppointmentService: class AppointmentService {} }));

import { AssignmentSlaScheduler } from './appointment-assignment-sla.scheduler';
import { SLA_LOCK_KEY } from './appointment-assignment-sla.config';
import { AssignmentTaskStatus } from './enums/assignment-task-status.enum';

// All SLA windows = default minutes; tests build timestamps relative to "now".
const MIN = 60_000;

function findChain(result: any[]) {
  return { limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(result) }) };
}

function createScheduler(opts: {
  reminderCandidates?: any[];
  overdue?: any[];
  stale?: any[];
  lockAcquired?: boolean;
  modifiedCount?: number;
} = {}) {
  const reminderCandidates = opts.reminderCandidates ?? [];
  const overdue = opts.overdue ?? [];
  const stale = opts.stale ?? [];

  // find() is called in order: reminders, expiry, reclaim.
  const find = jest
    .fn()
    .mockReturnValueOnce(findChain(reminderCandidates))
    .mockReturnValueOnce(findChain(overdue))
    .mockReturnValueOnce(findChain(stale));

  const taskModel = {
    find,
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: opts.modifiedCount ?? 1 }),
  };
  const redisService = {
    acquireSlotLock: jest.fn().mockResolvedValue(opts.lockAcquired ?? true),
    releaseSlotLock: jest.fn().mockResolvedValue(undefined),
  };
  const eventEmitter = { emit: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(undefined) }; // use defaults
  const appointmentService = {
    cancelForAssignmentTimeout: jest.fn().mockResolvedValue({ code: 'SUCCESS' }),
  };

  const scheduler = new AssignmentSlaScheduler(
    taskModel as any,
    redisService as any,
    eventEmitter as any,
    config as any,
    appointmentService as any,
  );

  return { scheduler, taskModel, redisService, eventEmitter, appointmentService };
}

describe('AssignmentSlaScheduler.runSlaSweep', () => {
  it('acquires and releases the distributed lock', async () => {
    const { scheduler, redisService } = createScheduler();
    await scheduler.runSlaSweep();
    expect(redisService.acquireSlotLock).toHaveBeenCalledWith(SLA_LOCK_KEY, expect.any(String), expect.any(Number));
    expect(redisService.releaseSlotLock).toHaveBeenCalledWith(SLA_LOCK_KEY, expect.any(String));
  });

  it('does nothing (no DB access) when the lock is not acquired', async () => {
    const { scheduler, taskModel, redisService } = createScheduler({ lockAcquired: false });
    await scheduler.runSlaSweep();
    expect(taskModel.find).not.toHaveBeenCalled();
    expect(redisService.releaseSlotLock).not.toHaveBeenCalled();
  });

  it('reminds a near-deadline PENDING task once and bumps reminder bookkeeping', async () => {
    const now = Date.now();
    const task = { _id: { toString: () => 'task-1' }, appointmentId: { toString: () => 'appt-1' }, deadlineAt: now + 5 * MIN, reminderCount: 0 };
    const { scheduler, taskModel, eventEmitter } = createScheduler({ reminderCandidates: [task] });

    await scheduler.runSlaSweep();

    expect(taskModel.updateOne).toHaveBeenCalledWith(
      { _id: task._id, status: AssignmentTaskStatus.PENDING },
      expect.objectContaining({ $set: expect.objectContaining({ lastNotifiedAt: expect.any(Number) }), $inc: { reminderCount: 1 } }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'appointment.assignment.reminder',
      expect.objectContaining({ taskId: 'task-1', appointmentId: 'appt-1', reminderCount: 1 }),
    );
  });

  it('does not emit a reminder if the conditional update matched nothing (already reminded)', async () => {
    const now = Date.now();
    const task = { _id: { toString: () => 'task-1' }, appointmentId: { toString: () => 'appt-1' }, deadlineAt: now + 5 * MIN, reminderCount: 1 };
    const { scheduler, eventEmitter } = createScheduler({ reminderCandidates: [task], modifiedCount: 0 });

    await scheduler.runSlaSweep();

    expect(eventEmitter.emit).not.toHaveBeenCalledWith('appointment.assignment.reminder', expect.anything());
  });

  it('delegates an overdue PENDING task to system timeout cancellation', async () => {
    const now = Date.now();
    const task = { _id: { toString: () => 'task-2' }, appointmentId: { toString: () => 'appt-2' }, deadlineAt: now - 60 * MIN };
    const { scheduler, taskModel, eventEmitter, appointmentService } = createScheduler({ overdue: [task] });

    await scheduler.runSlaSweep();

    expect(appointmentService.cancelForAssignmentTimeout).toHaveBeenCalledWith('task-2');
    expect(taskModel.updateOne).not.toHaveBeenCalledWith(
      { _id: task._id, status: AssignmentTaskStatus.PENDING },
      expect.anything(),
    );
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('appointment.assignment.expired', expect.anything());
  });

  it('reclaims a stale ASSIGNED task back to PENDING', async () => {
    const now = Date.now();
    const task = { _id: { toString: () => 'task-3' }, appointmentId: { toString: () => 'appt-3' }, acceptedAt: now - 60 * MIN };
    const { scheduler, taskModel } = createScheduler({ stale: [task] });

    await scheduler.runSlaSweep();

    const call = (taskModel.updateOne as jest.Mock).mock.calls[0];
    expect(call[0]).toMatchObject({ _id: task._id, status: AssignmentTaskStatus.ASSIGNED });
    expect(call[1].$set).toEqual({ status: AssignmentTaskStatus.PENDING });
    expect(call[1].$unset).toEqual({ acceptedByReceptionistId: '', acceptedAt: '' });
  });

  it('does not emit cancellation side effects itself; AppointmentService owns them', async () => {
    const now = Date.now();
    const { scheduler, eventEmitter, appointmentService } = createScheduler({
      overdue: [{ _id: { toString: () => 't' }, appointmentId: { toString: () => 'a' }, deadlineAt: now - 60 * MIN }],
    });

    await scheduler.runSlaSweep();

    expect(appointmentService.cancelForAssignmentTimeout).toHaveBeenCalledWith('t');
    const emittedEvents = (eventEmitter.emit as jest.Mock).mock.calls.map((c) => c[0]);
    expect(emittedEvents).not.toContain('appointment.cancelled');
    expect(emittedEvents).not.toContain('notify.patient.appointment.cancelled');
  });
});
