/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- inspecting jest mock.calls is inherently untyped */
jest.mock('src/account/schemas/account.schema', () => ({
  Account: class Account {},
}));

import { RoleEnum } from 'src/common/enum/role.enum';
import { AssignmentNotificationListener } from './assignment.notify.listenner';

function createListener(
  receptionists: Array<{ email: string }>,
  onlineReceptionists: Array<{
    userId: string;
    email?: string;
    role: string;
  }> = [],
) {
  const publisher = { publish: jest.fn().mockResolvedValue(undefined) };
  const accountModel = {
    find: jest.fn().mockReturnValue({
      select: jest
        .fn()
        .mockReturnValue({ lean: jest.fn().mockResolvedValue(receptionists) }),
    }),
  };
  const presenceService = {
    getOnlineReceptionists: jest.fn().mockResolvedValue(onlineReceptionists),
  };
  const listener = new AssignmentNotificationListener(
    publisher as any,
    accountModel as any,
    presenceService as any,
  );
  return { listener, publisher, accountModel, presenceService };
}

const createdEvent = {
  taskId: 'task-1',
  appointmentId: 'appt-1',
  specialty: 'cardiology',
  reasonForAppointment: 'chest pain',
  deadlineAt: Date.now() + 30 * 60_000,
  priority: 'NORMAL',
};

describe('AssignmentNotificationListener', () => {
  describe('appointment.assignment.created', () => {
    it('publishes one ASSIGNMENT_TASK_CREATED job per receptionist', async () => {
      const { listener, publisher, accountModel } = createListener([
        { email: 'recep1@x.com' },
        { email: 'Recep2@X.com' },
      ]);

      await listener.handleAssignmentCreated(createdEvent);

      expect(accountModel.find).toHaveBeenCalledWith({
        role: RoleEnum.RECEPTIONIST,
      });
      expect(publisher.publish).toHaveBeenCalledTimes(2);
      const first = publisher.publish.mock.calls[0][0];
      expect(first).toMatchObject({
        type: 'ASSIGNMENT_TASK_CREATED',
        recipientEmail: 'recep1@x.com',
        idempotencyKey: 'ASSIGNMENT_TASK_CREATED:task-1:recep1@x.com',
        data: {
          taskId: 'task-1',
          appointmentId: 'appt-1',
          specialty: 'cardiology',
          priority: 'NORMAL',
        },
      });
      // Email is normalized (trim + lowercase) in the idempotency key.
      expect(publisher.publish.mock.calls[1][0].idempotencyKey).toBe(
        'ASSIGNMENT_TASK_CREATED:task-1:recep2@x.com',
      );
    });

    it('produces a stable idempotency key so a duplicate event dedupes downstream', async () => {
      const { listener, publisher } = createListener([
        { email: 'recep1@x.com' },
      ]);

      await listener.handleAssignmentCreated(createdEvent);
      await listener.handleAssignmentCreated(createdEvent);

      const keys = publisher.publish.mock.calls.map((c) => c[0].idempotencyKey);
      expect(keys).toEqual([
        'ASSIGNMENT_TASK_CREATED:task-1:recep1@x.com',
        'ASSIGNMENT_TASK_CREATED:task-1:recep1@x.com',
      ]);
    });

    it('does nothing when there are no receptionists', async () => {
      const { listener, publisher } = createListener([]);
      await listener.handleAssignmentCreated(createdEvent);
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('targets an online receptionist (from Redis presence) with online=true', async () => {
      const { listener, publisher, presenceService } = createListener(
        [{ email: 'recep1@x.com' }, { email: 'recep2@x.com' }],
        [{ userId: 'r1', email: 'Recep1@X.com', role: 'RECEPTIONIST' }],
      );

      await listener.handleAssignmentCreated(createdEvent);

      expect(presenceService.getOnlineReceptionists).toHaveBeenCalledTimes(1);
      // DB fan-out still reaches all receptionists; only the online one is flagged online=true.
      const byEmail = Object.fromEntries(
        publisher.publish.mock.calls.map((c) => [
          c[0].recipientEmail,
          c[0].data.online,
        ]),
      );
      expect(byEmail['recep1@x.com']).toBe(true);
      expect(byEmail['recep2@x.com']).toBe(false);
    });

    it('does not throw and still persists notifications when no receptionist is online', async () => {
      const { listener, publisher } = createListener(
        [{ email: 'recep1@x.com' }],
        [],
      );

      await expect(
        listener.handleAssignmentCreated(createdEvent),
      ).resolves.toBeUndefined();

      // Offline-safe: the DB notification is still published (online=false); polling remains fallback.
      expect(publisher.publish).toHaveBeenCalledTimes(1);
      expect(publisher.publish.mock.calls[0][0].data.online).toBe(false);
    });

    it('does not flag a non-receptionist as a receptionist target', async () => {
      // Presence only ever returns receptionists; a patient being online never appears here.
      const { listener, publisher } = createListener(
        [{ email: 'recep1@x.com' }],
        [{ userId: 'p1', email: 'patient@x.com', role: 'PATIENT' }],
      );

      await listener.handleAssignmentCreated(createdEvent);

      expect(publisher.publish).toHaveBeenCalledTimes(1);
      // recep1 is not in the (patient-only) online set, so it is targeted as offline.
      expect(publisher.publish.mock.calls[0][0].recipientEmail).toBe(
        'recep1@x.com',
      );
      expect(publisher.publish.mock.calls[0][0].data.online).toBe(false);
    });

    it('degrades to polling (does not throw) when Redis presence lookup fails', async () => {
      const { listener, publisher, presenceService } = createListener([
        { email: 'recep1@x.com' },
      ]);
      presenceService.getOnlineReceptionists.mockRejectedValueOnce(
        new Error('redis down'),
      );

      await expect(
        listener.handleAssignmentCreated(createdEvent),
      ).resolves.toBeUndefined();

      expect(publisher.publish).toHaveBeenCalledTimes(1);
      expect(publisher.publish.mock.calls[0][0].data.online).toBe(false);
    });
  });

  describe('appointment.assignment.reminder', () => {
    const reminderEvent = {
      taskId: 'task-1',
      appointmentId: 'appt-1',
      deadlineAt: Date.now() + 5 * 60_000,
      reminderCount: 2,
    };

    it('publishes a reminder per receptionist and flags the online one', async () => {
      const { listener, publisher } = createListener(
        [{ email: 'recep1@x.com' }, { email: 'recep2@x.com' }],
        [{ userId: 'r1', email: 'recep1@x.com', role: 'RECEPTIONIST' }],
      );

      await listener.handleAssignmentReminder(reminderEvent);

      expect(publisher.publish).toHaveBeenCalledTimes(2);
      const first = publisher.publish.mock.calls[0][0];
      expect(first.type).toBe('ASSIGNMENT_TASK_REMINDER');
      expect(first.idempotencyKey).toBe(
        'ASSIGNMENT_TASK_REMINDER:task-1:2:recep1@x.com',
      );
      expect(first.data.online).toBe(true);
      expect(publisher.publish.mock.calls[1][0].data.online).toBe(false);
    });

    it('keys reminders by reminderCount so repeats are distinct but retries dedupe', async () => {
      const { listener, publisher } = createListener([
        { email: 'recep1@x.com' },
      ]);

      await listener.handleAssignmentReminder(reminderEvent); // count 2
      await listener.handleAssignmentReminder(reminderEvent); // count 2 (retry -> same key)
      await listener.handleAssignmentReminder({
        ...reminderEvent,
        reminderCount: 3,
      });

      const keys = publisher.publish.mock.calls.map((c) => c[0].idempotencyKey);
      expect(keys).toEqual([
        'ASSIGNMENT_TASK_REMINDER:task-1:2:recep1@x.com',
        'ASSIGNMENT_TASK_REMINDER:task-1:2:recep1@x.com',
        'ASSIGNMENT_TASK_REMINDER:task-1:3:recep1@x.com',
      ]);
    });

    it('does not throw when no receptionist is online', async () => {
      const { listener, publisher } = createListener(
        [{ email: 'recep1@x.com' }],
        [],
      );

      await expect(
        listener.handleAssignmentReminder(reminderEvent),
      ).resolves.toBeUndefined();
      expect(publisher.publish).toHaveBeenCalledTimes(1);
      expect(publisher.publish.mock.calls[0][0].data.online).toBe(false);
    });

    it('does nothing (no throw) when there are no receptionists', async () => {
      const { listener, publisher } = createListener([]);
      await expect(
        listener.handleAssignmentReminder(reminderEvent),
      ).resolves.toBeUndefined();
      expect(publisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('appointment.assignment.expired', () => {
    const expiredEvent = {
      taskId: 'task-1',
      appointmentId: 'appt-1',
      deadlineAt: Date.now() - 60_000,
    };

    it('publishes an expiry notification per receptionist with a stable idempotency key', async () => {
      const { listener, publisher } = createListener([
        { email: 'recep1@x.com' },
      ]);

      await listener.handleAssignmentExpired(expiredEvent);
      await listener.handleAssignmentExpired(expiredEvent);

      const calls = publisher.publish.mock.calls;
      expect(calls[0][0].type).toBe('ASSIGNMENT_TASK_EXPIRED');
      expect(calls.map((c) => c[0].idempotencyKey)).toEqual([
        'ASSIGNMENT_TASK_EXPIRED:task-1:recep1@x.com',
        'ASSIGNMENT_TASK_EXPIRED:task-1:recep1@x.com',
      ]);
    });

    it('does not throw when no receptionist is online', async () => {
      const { listener, publisher } = createListener(
        [{ email: 'recep1@x.com' }],
        [],
      );

      await expect(
        listener.handleAssignmentExpired(expiredEvent),
      ).resolves.toBeUndefined();
      expect(publisher.publish).toHaveBeenCalledTimes(1);
      expect(publisher.publish.mock.calls[0][0].data.online).toBe(false);
    });
  });

  describe('appointment.assignment.completed', () => {
    it('publishes an APPOINTMENT_DOCTOR_ASSIGNED job to the patient', async () => {
      const { listener, publisher } = createListener([]);

      await listener.handleAssignmentCompleted({
        taskId: 'task-1',
        appointmentId: 'appt-1',
        doctorId: 'doc-1',
        timeSlotId: 'slot-1',
        scheduledAt: 123,
        patientEmail: 'Patient@X.com',
      });

      expect(publisher.publish).toHaveBeenCalledTimes(1);
      expect(publisher.publish.mock.calls[0][0]).toMatchObject({
        type: 'APPOINTMENT_DOCTOR_ASSIGNED',
        recipientEmail: 'patient@x.com',
        idempotencyKey: 'APPOINTMENT_DOCTOR_ASSIGNED:appt-1:patient@x.com',
        data: {
          appointmentId: 'appt-1',
          doctorId: 'doc-1',
          timeSlotId: 'slot-1',
          scheduledAt: 123,
        },
      });
    });

    it('skips when patientEmail is missing', async () => {
      const { listener, publisher } = createListener([]);
      await listener.handleAssignmentCompleted({
        taskId: 'task-1',
        appointmentId: 'appt-1',
        doctorId: 'doc-1',
        timeSlotId: 'slot-1',
        scheduledAt: 123,
      });
      expect(publisher.publish).not.toHaveBeenCalled();
    });
  });
});
