import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account, AccountDocument } from 'src/account/schemas/account.schema';
import { RoleEnum } from 'src/common/enum/role.enum';
import { PresenceService } from 'src/socket/presence.service';
import { NotificationJobPublisher } from '../notification-job.publisher';

// Payloads emitted by the broad-booking / assignment flow (Batches 4-5).
export type AssignmentCreatedEvent = {
  taskId: string;
  appointmentId: string;
  patientEmail?: string;
  specialty?: string;
  priority?: string;
  deadlineAt: number;
  reasonForAppointment?: string;
};

export type AssignmentCompletedEvent = {
  taskId: string;
  appointmentId: string;
  doctorId: string;
  timeSlotId: string;
  scheduledAt: number;
  patientEmail?: string;
};

// Emitted by AssignmentSlaScheduler when a PENDING task nears its deadline.
export type AssignmentReminderEvent = {
  taskId: string;
  appointmentId?: string;
  deadlineAt: number;
  reminderCount?: number;
};

// Emitted by AssignmentSlaScheduler when a PENDING task passes deadline + grace.
export type AssignmentExpiredEvent = {
  taskId: string;
  appointmentId?: string;
  deadlineAt: number;
  actor?: string;
  reasonCode?: string;
};

/**
 * Fan-out for assignment events. Reuses the existing notification job pipeline
 * (publish -> queue -> handler -> DB write + Redis socket bridge).
 *
 * Realtime targeting is driven by Redis role-aware presence
 * ({@link PresenceService.getOnlineReceptionists}); the DB notification + idempotency
 * fan-out is kept for ALL receptionists so offline staff still see the task on next load,
 * and the AppointmentAssignmentTask queue (DB) remains the source of truth + polling fallback.
 */
@Injectable()
export class AssignmentNotificationListener {
  private readonly logger = new Logger(AssignmentNotificationListener.name);

  constructor(
    private readonly notificationPublisher: NotificationJobPublisher,
    @InjectModel(Account.name)
    private readonly accountModel: Model<AccountDocument>,
    private readonly presenceService: PresenceService,
  ) {}

  @OnEvent('appointment.assignment.created')
  async handleAssignmentCreated(
    payload: AssignmentCreatedEvent,
  ): Promise<void> {
    const targets = await this.resolveReceptionistTargets(
      payload.taskId,
      'created',
    );
    if (!targets) {
      return;
    }

    for (const recipientEmail of targets.recipientEmails) {
      await this.notificationPublisher.publish({
        type: 'ASSIGNMENT_TASK_CREATED',
        data: {
          taskId: payload.taskId,
          appointmentId: payload.appointmentId,
          specialty: payload.specialty,
          reasonForAppointment: payload.reasonForAppointment,
          deadlineAt: payload.deadlineAt,
          priority: payload.priority,
          // Whether Redis presence saw this receptionist online at emit time.
          online: targets.onlineEmails.has(recipientEmail),
        },
        createdAt: Date.now(),
        recipientEmail,
        recipientRole: 'RECEPTIONIST',
        // One notification per receptionist per task; duplicate events dedupe on this key.
        idempotencyKey: `ASSIGNMENT_TASK_CREATED:${payload.taskId}:${recipientEmail}`,
      });
    }
  }

  @OnEvent('appointment.assignment.reminder')
  async handleAssignmentReminder(
    payload: AssignmentReminderEvent,
  ): Promise<void> {
    try {
      const targets = await this.resolveReceptionistTargets(
        payload.taskId,
        'reminder',
      );
      if (!targets) {
        return;
      }

      for (const recipientEmail of targets.recipientEmails) {
        await this.notificationPublisher.publish({
          type: 'ASSIGNMENT_TASK_REMINDER',
          data: {
            taskId: payload.taskId,
            appointmentId: payload.appointmentId,
            deadlineAt: payload.deadlineAt,
            reminderCount: payload.reminderCount,
            online: targets.onlineEmails.has(recipientEmail),
          },
          createdAt: Date.now(),
          recipientEmail,
          recipientRole: 'RECEPTIONIST',
          // reminderCount keeps each reminder distinct, while retries of the same reminder dedupe.
          idempotencyKey: `ASSIGNMENT_TASK_REMINDER:${payload.taskId}:${payload.reminderCount ?? 0}:${recipientEmail}`,
        });
      }
    } catch (error) {
      // Never let a notification failure bubble back into the SLA scheduler.
      this.logger.error(
        `[Assignment] reminder notification failed for task ${payload.taskId}: ${(error as Error).message}`,
      );
    }
  }

  @OnEvent('appointment.assignment.expired')
  async handleAssignmentExpired(
    payload: AssignmentExpiredEvent,
  ): Promise<void> {
    try {
      // MVP: notify receptionists (admin escalation is documented as a future improvement).
      const targets = await this.resolveReceptionistTargets(
        payload.taskId,
        'expired',
      );
      if (!targets) {
        return;
      }

      for (const recipientEmail of targets.recipientEmails) {
        await this.notificationPublisher.publish({
          type: 'ASSIGNMENT_TASK_EXPIRED',
          data: {
            taskId: payload.taskId,
            appointmentId: payload.appointmentId,
            deadlineAt: payload.deadlineAt,
            actor: payload.actor,
            reasonCode: payload.reasonCode,
            online: targets.onlineEmails.has(recipientEmail),
          },
          createdAt: Date.now(),
          recipientEmail,
          recipientRole: 'RECEPTIONIST',
          // Expiry is a one-time transition per task; one notification per recipient.
          idempotencyKey: `ASSIGNMENT_TASK_EXPIRED:${payload.taskId}:${recipientEmail}`,
        });
      }
    } catch (error) {
      this.logger.error(
        `[Assignment] expired notification failed for task ${payload.taskId}: ${(error as Error).message}`,
      );
    }
  }

  // Resolve the receptionist DB fan-out list + the Redis online subset, with consistent logging.
  // Returns null when there are no receptionist accounts at all.
  private async resolveReceptionistTargets(
    taskId: string,
    context: 'created' | 'reminder' | 'expired',
  ): Promise<{ recipientEmails: string[]; onlineEmails: Set<string> } | null> {
    // Redis role-aware presence decides realtime targets. A presence/Redis hiccup must never
    // fail the flow, so resolveOnlineReceptionistEmails degrades to "none online".
    const onlineEmails = await this.resolveOnlineReceptionistEmails(taskId);

    const receptionists = await this.accountModel
      .find({ role: RoleEnum.RECEPTIONIST })
      .select('email')
      .lean();

    if (!receptionists.length) {
      this.logger.warn(
        `No receptionist accounts to notify for ${context} task ${taskId}`,
      );
      return null;
    }

    if (onlineEmails.size === 0) {
      // Not an error: the task stays in the DB queue and will be picked up via polling.
      this.logger.warn(
        `[Assignment] No online receptionist for ${context} task ${taskId}; relying on the assignment-task polling queue.`,
      );
    } else {
      this.logger.log(
        `[Assignment] ${context} task ${taskId}: targeting ${onlineEmails.size} online receptionist(s) for realtime: ${[...onlineEmails].join(', ')}`,
      );
    }

    const recipientEmails = receptionists
      .map((r) => r.email?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email));

    return { recipientEmails, onlineEmails };
  }

  // Resolve the set of currently-online receptionist emails (normalized) from Redis presence.
  // Failures are swallowed and treated as "nobody online" so booking never breaks on Redis.
  private async resolveOnlineReceptionistEmails(
    taskId: string,
  ): Promise<Set<string>> {
    try {
      const online = await this.presenceService.getOnlineReceptionists();
      return new Set(
        online
          .map((r) => r.email?.trim().toLowerCase())
          .filter((email): email is string => Boolean(email)),
      );
    } catch (error) {
      this.logger.warn(
        `[Assignment] Failed to resolve online receptionists for task ${taskId} from Redis: ${(error as Error).message}. Falling back to polling queue.`,
      );
      return new Set<string>();
    }
  }

  @OnEvent('appointment.assignment.completed')
  async handleAssignmentCompleted(
    payload: AssignmentCompletedEvent,
  ): Promise<void> {
    if (!payload.patientEmail) {
      this.logger.warn(
        `No patientEmail on assignment.completed for appointment ${payload.appointmentId}`,
      );
      return;
    }

    const recipientEmail = payload.patientEmail.trim().toLowerCase();
    await this.notificationPublisher.publish({
      type: 'APPOINTMENT_DOCTOR_ASSIGNED',
      data: {
        appointmentId: payload.appointmentId,
        doctorId: payload.doctorId,
        timeSlotId: payload.timeSlotId,
        scheduledAt: payload.scheduledAt,
        patientEmail: payload.patientEmail,
      },
      createdAt: Date.now(),
      recipientEmail,
      recipientRole: 'PATIENT',
      idempotencyKey: `APPOINTMENT_DOCTOR_ASSIGNED:${payload.appointmentId}:${recipientEmail}`,
    });
  }
}
