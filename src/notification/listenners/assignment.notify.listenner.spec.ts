jest.mock('src/account/schemas/account.schema', () => ({ Account: class Account {} }));

import { RoleEnum } from 'src/common/enum/role.enum';
import { AssignmentNotificationListener } from './assignment.notify.listenner';

function createListener(receptionists: Array<{ email: string }>) {
  const publisher = { publish: jest.fn().mockResolvedValue(undefined) };
  const accountModel = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(receptionists) }),
    }),
  };
  const listener = new AssignmentNotificationListener(publisher as any, accountModel as any);
  return { listener, publisher, accountModel };
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

      expect(accountModel.find).toHaveBeenCalledWith({ role: RoleEnum.RECEPTIONIST });
      expect(publisher.publish).toHaveBeenCalledTimes(2);
      const first = publisher.publish.mock.calls[0][0];
      expect(first).toMatchObject({
        type: 'ASSIGNMENT_TASK_CREATED',
        recipientEmail: 'recep1@x.com',
        idempotencyKey: 'ASSIGNMENT_TASK_CREATED:task-1:recep1@x.com',
        data: { taskId: 'task-1', appointmentId: 'appt-1', specialty: 'cardiology', priority: 'NORMAL' },
      });
      // Email is normalized (trim + lowercase) in the idempotency key.
      expect(publisher.publish.mock.calls[1][0].idempotencyKey).toBe(
        'ASSIGNMENT_TASK_CREATED:task-1:recep2@x.com',
      );
    });

    it('produces a stable idempotency key so a duplicate event dedupes downstream', async () => {
      const { listener, publisher } = createListener([{ email: 'recep1@x.com' }]);

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
        data: { appointmentId: 'appt-1', doctorId: 'doc-1', timeSlotId: 'slot-1', scheduledAt: 123 },
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
