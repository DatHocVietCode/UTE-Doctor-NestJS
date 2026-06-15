import { AssignmentTaskCreatedNotificationHandler } from './assignment-task-created-notification.handler';

const meta = {
  recipientEmail: 'recep1@x.com',
  recipientRole: 'RECEPTIONIST' as const,
  createdAt: 1700000000000,
  idempotencyKey: 'ASSIGNMENT_TASK_CREATED:task-1:recep1@x.com',
};

const payload = {
  taskId: 'task-1',
  appointmentId: 'appt-1',
  specialty: 'cardiology',
  reasonForAppointment: 'chest pain',
  deadlineAt: 1700001800000,
  priority: 'NORMAL',
};

function createHandler(stored: boolean) {
  const write = { storeIfNotExists: jest.fn().mockResolvedValue(stored) };
  const redis = { publish: jest.fn().mockResolvedValue(undefined) };
  return {
    handler: new AssignmentTaskCreatedNotificationHandler(
      write as any,
      redis as any,
    ),
    write,
    redis,
  };
}

describe('AssignmentTaskCreatedNotificationHandler', () => {
  it('stores the notification and emits on the socket bridge when new', async () => {
    const { handler, write, redis } = createHandler(true);

    await handler.handle(payload, meta);

    expect(write.storeIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: meta.idempotencyKey,
        receiverEmail: [meta.recipientEmail],
        recipientEmail: meta.recipientEmail,
        recipientRole: 'RECEPTIONIST',
        details: expect.objectContaining({
          type: 'assignment_task_created',
          taskId: 'task-1',
          recipientRole: 'RECEPTIONIST',
        }),
      }),
    );
    expect(redis.publish).toHaveBeenCalledTimes(1);
  });

  it('does not emit again for a duplicate (idempotencyKey already stored)', async () => {
    const { handler, redis } = createHandler(false);
    await handler.handle(payload, meta);
    expect(redis.publish).not.toHaveBeenCalled();
  });
});
