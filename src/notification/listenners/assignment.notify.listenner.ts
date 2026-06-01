import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account, AccountDocument } from 'src/account/schemas/account.schema';
import { RoleEnum } from 'src/common/enum/role.enum';
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

/**
 * MVP fan-out for assignment events. Reuses the existing notification job pipeline
 * (publish -> queue -> handler -> DB write + Redis socket bridge). No new gateway and
 * no role-aware presence: receptionists are resolved from Account by role.
 */
@Injectable()
export class AssignmentNotificationListener {
  private readonly logger = new Logger(AssignmentNotificationListener.name);

  constructor(
    private readonly notificationPublisher: NotificationJobPublisher,
    @InjectModel(Account.name) private readonly accountModel: Model<AccountDocument>,
  ) {}

  @OnEvent('appointment.assignment.created')
  async handleAssignmentCreated(payload: AssignmentCreatedEvent): Promise<void> {
    const receptionists = await this.accountModel
      .find({ role: RoleEnum.RECEPTIONIST })
      .select('email')
      .lean();

    if (!receptionists.length) {
      this.logger.warn(`No receptionist accounts to notify for task ${payload.taskId}`);
      return;
    }

    for (const receptionist of receptionists) {
      if (!receptionist.email) continue;
      const recipientEmail = receptionist.email.trim().toLowerCase();
      await this.notificationPublisher.publish({
        type: 'ASSIGNMENT_TASK_CREATED',
        data: {
          taskId: payload.taskId,
          appointmentId: payload.appointmentId,
          specialty: payload.specialty,
          reasonForAppointment: payload.reasonForAppointment,
          deadlineAt: payload.deadlineAt,
          priority: payload.priority,
        },
        createdAt: Date.now(),
        recipientEmail,
        // One notification per receptionist per task; duplicate events dedupe on this key.
        idempotencyKey: `ASSIGNMENT_TASK_CREATED:${payload.taskId}:${recipientEmail}`,
      });
    }
  }

  @OnEvent('appointment.assignment.completed')
  async handleAssignmentCompleted(payload: AssignmentCompletedEvent): Promise<void> {
    if (!payload.patientEmail) {
      this.logger.warn(`No patientEmail on assignment.completed for appointment ${payload.appointmentId}`);
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
      idempotencyKey: `APPOINTMENT_DOCTOR_ASSIGNED:${payload.appointmentId}:${recipientEmail}`,
    });
  }
}
