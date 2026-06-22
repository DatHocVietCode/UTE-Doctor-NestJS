import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as appointmentEnriched from 'src/appointment/schemas/appointment-enriched';
import type { AppointmentRescheduledEnriched } from 'src/appointment/listenners/reschedule.listener';
import type { NotificationPayload } from '../dto/notification-payload.dto';
import { NotificationJobPublisher } from '../notification-job.publisher';

@Injectable()
export class AppointmentNotificationListener {
  constructor(
    private readonly notificationPublisher: NotificationJobPublisher,
  ) {}

  private async publish(payload: NotificationPayload): Promise<void> {
    await this.notificationPublisher.publish(payload);
  }

  @OnEvent('notify.patient.booking.success')
  async handlePatientNotification(
    payload: appointmentEnriched.AppointmentEnriched,
  ) {
    const recipientEmail = payload.patientEmail.trim().toLowerCase();
    await this.publish({
      type: 'APPOINTMENT_SUCCESS',
      data: payload,
      createdAt: Date.now(),
      recipientEmail,
      recipientRole: 'PATIENT',
      idempotencyKey: `APPOINTMENT_SUCCESS:${payload._id?.toString?.() || payload._id}:${recipientEmail}`,
    });
  }

  @OnEvent('notify.doctor.booking.success')
  async handleDoctorNotification(
    payload: appointmentEnriched.AppointmentEnriched,
  ) {
    if (!payload.doctorEmail) {
      return;
    }

    const recipientEmail = payload.doctorEmail.trim().toLowerCase();

    await this.publish({
      type: 'APPOINTMENT_SUCCESS',
      data: payload,
      createdAt: Date.now(),
      recipientEmail,
      recipientRole: 'DOCTOR',
      idempotencyKey: `APPOINTMENT_SUCCESS:${payload._id?.toString?.() || payload._id}:${recipientEmail}`,
    });
  }

  @OnEvent('notify.patient.appointment.rescheduled')
  async handlePatientRescheduledNotification(
    payload: AppointmentRescheduledEnriched,
  ) {
    const recipientEmail = payload.patientEmail.trim().toLowerCase();
    await this.publish({
      type: 'APPOINTMENT_RESCHEDULED',
      data: {
        appointmentId: payload.appointmentId,
        patientEmail: payload.patientEmail,
        doctorEmail: payload.doctorEmail,
        doctorName: payload.doctorName,
        hospitalName: payload.hospitalName,
        oldScheduledAt: payload.oldScheduledAt,
        newScheduledAt: payload.newScheduledAt,
        newTimeSlotId: payload.newTimeSlotId,
        reason: payload.reason,
      },
      createdAt: Date.now(),
      recipientEmail,
      recipientRole: 'PATIENT',
      idempotencyKey: `APPOINTMENT_RESCHEDULED:${payload.appointmentId}:${recipientEmail}`,
    });
  }

  @OnEvent('notify.doctor.appointment.rescheduled')
  async handleDoctorRescheduledNotification(
    payload: AppointmentRescheduledEnriched,
  ) {
    if (!payload.doctorEmail) return;
    const recipientEmail = payload.doctorEmail.trim().toLowerCase();
    await this.publish({
      type: 'APPOINTMENT_RESCHEDULED',
      data: {
        appointmentId: payload.appointmentId,
        patientEmail: payload.patientEmail,
        doctorEmail: payload.doctorEmail,
        doctorName: payload.doctorName,
        hospitalName: payload.hospitalName,
        oldScheduledAt: payload.oldScheduledAt,
        newScheduledAt: payload.newScheduledAt,
        newTimeSlotId: payload.newTimeSlotId,
        reason: payload.reason,
      },
      createdAt: Date.now(),
      recipientEmail,
      recipientRole: 'DOCTOR',
      idempotencyKey: `APPOINTMENT_RESCHEDULED:${payload.appointmentId}:${recipientEmail}`,
    });
  }

  @OnEvent('notify.patient.shift.cancelled')
  async handlePatientShiftCancelled(payload: {
    patientEmail: string;
    doctorName?: string;
    date: string;
    timeSlot: string;
    hospitalName?: string;
    reason?: string;
  }) {
    const recipientEmail = payload.patientEmail.trim().toLowerCase();
    await this.publish({
      type: 'APPOINTMENT_CANCELLED',
      data: {
        appointmentId: 'shift-cancelled',
        patientEmail: payload.patientEmail,
        date: payload.date,
        timeSlot: payload.timeSlot,
        hospitalName: payload.hospitalName,
        reason: payload.reason,
      },
      createdAt: Date.now(),
      recipientEmail,
      recipientRole: 'PATIENT',
      idempotencyKey: `APPOINTMENT_CANCELLED:shift:${recipientEmail}:${payload.date}:${payload.timeSlot}`,
    });
  }

  @OnEvent('notify.doctor.shift.cancelled')
  async handleDoctorShiftCancelled(payload: {
    doctorEmail: string;
    date: string;
    shift: string;
    reason?: string;
    affectedAppointmentsCount: number;
  }) {
    const recipientEmail = payload.doctorEmail.trim().toLowerCase();
    await this.publish({
      type: 'APPOINTMENT_CANCELLED',
      data: {
        appointmentId: `doctor-shift-${payload.date}-${payload.shift}`,
        patientEmail: payload.doctorEmail,
        doctorEmail: payload.doctorEmail,
        date: payload.date,
        timeSlot: payload.shift,
        reason: payload.reason,
      },
      createdAt: Date.now(),
      recipientEmail,
      recipientRole: 'DOCTOR',
      idempotencyKey: `APPOINTMENT_CANCELLED:doctor-shift:${recipientEmail}:${payload.date}:${payload.shift}`,
    });
  }

  @OnEvent('notify.appointment.no_show')
  async handleAppointmentNoShow(payload: {
    appointmentId?: string;
    patientEmail: string;
    doctorEmail?: string;
    doctorName?: string;
    date: string | number | Date;
    scheduledAt?: number;
    timeSlot?: string;
    timeSlotLabel?: string;
    hospitalName?: string;
    reason?: string;
    actor?: string;
    source?: string;
    depositStatus?: string;
  }) {
    const data = {
      appointmentId: payload.appointmentId || 'appointment-no-show',
      patientEmail: payload.patientEmail,
      doctorEmail: payload.doctorEmail,
      doctorName: payload.doctorName,
      date: payload.date,
      scheduledAt: payload.scheduledAt,
      timeSlot: payload.timeSlot,
      timeSlotLabel: payload.timeSlotLabel,
      hospitalName: payload.hospitalName,
      reason: payload.reason,
      actor: payload.actor,
      source: payload.source,
      depositStatus: payload.depositStatus,
    };

    const patientRecipient = payload.patientEmail.trim().toLowerCase();
    await this.publish({
      type: 'APPOINTMENT_NO_SHOW',
      data,
      createdAt: Date.now(),
      recipientEmail: patientRecipient,
      recipientRole: 'PATIENT',
      idempotencyKey: `APPOINTMENT_NO_SHOW:${data.appointmentId}:${patientRecipient}`,
    });

    if (payload.doctorEmail) {
      const doctorRecipient = payload.doctorEmail.trim().toLowerCase();
      await this.publish({
        type: 'APPOINTMENT_NO_SHOW',
        data: { ...data, patientEmail: payload.patientEmail },
        createdAt: Date.now(),
        recipientEmail: doctorRecipient,
        recipientRole: 'DOCTOR',
        idempotencyKey: `APPOINTMENT_NO_SHOW:${data.appointmentId}:${doctorRecipient}`,
      });
    }
  }

  @OnEvent('notify.patient.appointment.cancelled')
  async handlePatientAppointmentCancelled(payload: {
    appointmentId?: string;
    patientEmail: string;
    doctorEmail?: string;
    doctorName?: string;
    date: string | number | Date;
    scheduledAt?: number;
    timeSlot: string;
    timeSlotLabel?: string;
    hospitalName?: string;
    reason?: string;
    refundAmount?: number;
    shouldRefund?: boolean;
    actor?: string;
    reasonCode?: string;
    assignmentTaskId?: string;
    deadlineAt?: number;
  }) {
    const patientRecipient = payload.patientEmail.trim().toLowerCase();
    await this.publish({
      type: 'APPOINTMENT_CANCELLED',
      data: {
        appointmentId: payload.appointmentId || 'appointment-cancelled',
        patientEmail: payload.patientEmail,
        doctorEmail: payload.doctorEmail,
        date: payload.date,
        scheduledAt: payload.scheduledAt,
        timeSlot: payload.timeSlot,
        timeSlotLabel: payload.timeSlotLabel,
        hospitalName: payload.hospitalName,
        reason: payload.reason,
        refundAmount: payload.refundAmount,
        shouldRefund: payload.shouldRefund,
        actor: payload.actor,
        reasonCode: payload.reasonCode,
        assignmentTaskId: payload.assignmentTaskId,
        deadlineAt: payload.deadlineAt,
      },
      createdAt: Date.now(),
      recipientEmail: patientRecipient,
      recipientRole: 'PATIENT',
      idempotencyKey: `APPOINTMENT_CANCELLED:${payload.appointmentId || 'na'}:${patientRecipient}`,
    });

    if (payload.doctorEmail) {
      const doctorRecipient = payload.doctorEmail.trim().toLowerCase();
      await this.publish({
        type: 'APPOINTMENT_CANCELLED',
        data: {
          appointmentId: payload.appointmentId || 'appointment-cancelled',
          patientEmail: payload.patientEmail,
          doctorEmail: payload.doctorEmail,
          date: payload.date,
          scheduledAt: payload.scheduledAt,
          timeSlot: payload.timeSlot,
          timeSlotLabel: payload.timeSlotLabel,
          hospitalName: payload.hospitalName,
          reason: payload.reason,
          refundAmount: payload.refundAmount,
          shouldRefund: payload.shouldRefund,
          actor: payload.actor,
          reasonCode: payload.reasonCode,
          assignmentTaskId: payload.assignmentTaskId,
          deadlineAt: payload.deadlineAt,
        },
        createdAt: Date.now(),
        recipientEmail: doctorRecipient,
        recipientRole: 'DOCTOR',
        idempotencyKey: `APPOINTMENT_CANCELLED:${payload.appointmentId || 'na'}:${doctorRecipient}`,
      });
    }
  }
}
