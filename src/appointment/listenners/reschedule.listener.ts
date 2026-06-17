import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Doctor } from 'src/doctor/schema/doctor.schema';
import { Profile } from 'src/profile/schema/profile.schema';

// Payload emitted by AppointmentRescheduleService after a successful reschedule.
export type AppointmentRescheduledPayload = {
  appointmentId: string;
  patientEmail: string;
  doctorId?: string;
  hospitalName?: string;
  oldScheduledAt: number;
  newScheduledAt: number;
  newStartTime: number;
  newEndTime: number;
  oldTimeSlotId?: string;
  newTimeSlotId: string;
  reason?: string;
  rescheduledBy?: string;
  rescheduledAt: number;
};

// Enriched payload forwarded to mail / notification / socket handlers.
export type AppointmentRescheduledEnriched = AppointmentRescheduledPayload & {
  doctorEmail?: string;
  doctorName?: string;
};

@Injectable()
export class RescheduleListener {
  private readonly logger = new Logger(RescheduleListener.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    @InjectModel(Doctor.name) private readonly doctorModel: Model<Doctor>,
    @InjectModel(Profile.name) private readonly profileModel: Model<Profile>,
  ) {}

  @OnEvent('appointment.rescheduled')
  async handleRescheduled(payload: AppointmentRescheduledPayload): Promise<void> {
    // Load doctor profile for email/name — best-effort, never fail the main flow.
    let doctorEmail: string | undefined;
    let doctorName: string | undefined;

    try {
      if (payload.doctorId) {
        const doctor = await this.doctorModel
          .findById(payload.doctorId)
          .select('profileId')
          .lean();

        if (doctor?.profileId) {
          const profile = await this.profileModel
            .findById(doctor.profileId)
            .select('email name')
            .lean();
          doctorEmail = (profile as any)?.email ?? undefined;
          doctorName = (profile as any)?.name ?? undefined;
        }
      }
    } catch (err: any) {
      this.logger.warn(`[RescheduleListener] Could not load doctor profile: ${err?.message}`);
    }

    const enriched: AppointmentRescheduledEnriched = {
      ...payload,
      doctorEmail,
      doctorName,
    };

    // Notify patient and doctor via notification pipeline.
    this.eventEmitter.emit('notify.patient.appointment.rescheduled', enriched);
    if (doctorEmail) {
      this.eventEmitter.emit('notify.doctor.appointment.rescheduled', enriched);
    }

    // Send confirmation mails.
    this.eventEmitter.emit('mail.patient.appointment.rescheduled', enriched);
    if (doctorEmail) {
      this.eventEmitter.emit('mail.doctor.appointment.rescheduled', enriched);
    }

    // Push real-time socket update to patient and doctor rooms.
    this.eventEmitter.emit('socket.appointment.rescheduled', enriched);

    this.logger.log(
      `[RescheduleListener] Side effects dispatched for appointmentId=${payload.appointmentId}`,
    );
  }
}
