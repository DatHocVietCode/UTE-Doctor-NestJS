import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { AppointmentEnriched } from "src/appointment/schemas/appointment-enriched";
import type { AppointmentRescheduledEnriched } from "src/appointment/listenners/reschedule.listener";
import type { CoinExpiryReminderEventPayload } from 'src/wallet/coin/coin-expiry-reminder/dto/coin-expiry-reminder.dto';
import { MailService } from "./mail.service";


@Injectable()
export class MailListener {
    constructor(private readonly mailService: MailService) {}

    private logMailError(eventName: string, error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[MailListener] ${eventName} failed: ${errorMsg}`);
    }

    @OnEvent('mail.patient.booking.success')
    async handlePatientBookingMail(payload: AppointmentEnriched) {
       try {
           await this.mailService.sendPatientBookingSuccessMail(payload);
       } catch (error) {
           this.logMailError('mail.patient.booking.success', error);
       }
    }

    @OnEvent('mail.doctor.booking.success')
    async handleDoctorBookingMail(payload: AppointmentEnriched) {
        try {
            await this.mailService.sendDoctorBookingSuccessMail(payload);
        } catch (error) {
            this.logMailError('mail.doctor.booking.success', error);
        }
    }

    @OnEvent('mail.patient.shift.cancelled')
    async handlePatientShiftCancelled(payload: {
        patientEmail: string;
        doctorName?: string;
        date: string;
        timeSlot: string;
        hospitalName?: string;
        reason?: string;
    }) {
        try {
            await this.mailService.sendPatientShiftCancellationMail(payload);
        } catch (error) {
            this.logMailError('mail.patient.shift.cancelled', error);
        }
    }

    @OnEvent('mail.doctor.shift.cancelled')
    async handleDoctorShiftCancelled(payload: {
        doctorEmail: string;
        doctorName?: string;
        date: string;
        shift: string;
        reason?: string;
        affectedAppointmentsCount: number;
    }) {
        try {
            await this.mailService.sendDoctorShiftCancellationMail(payload);
        } catch (error) {
            this.logMailError('mail.doctor.shift.cancelled', error);
        }
    }

    @OnEvent('mail.patient.appointment.cancelled')
    async handlePatientAppointmentCancelled(payload: {
        patientEmail: string;
        doctorName?: string;
        date: string;
        timeSlot: string;
        hospitalName?: string;
        reason?: string;
        refundAmount?: number;
        shouldRefund?: boolean;
        actor?: string;
        reasonCode?: string;
        assignmentTaskId?: string;
        deadlineAt?: number;
    }) {
        try {
            await this.mailService.sendPatientAppointmentCancellationMail(payload);
        } catch (error) {
            this.logMailError('mail.patient.appointment.cancelled', error);
        }
    }

    @OnEvent('mail.patient.appointment.rescheduled')
    async handlePatientRescheduleMail(payload: AppointmentRescheduledEnriched) {
        try {
            await this.mailService.sendPatientRescheduleMail(payload);
        } catch (error) {
            this.logMailError('mail.patient.appointment.rescheduled', error);
        }
    }

    @OnEvent('mail.doctor.appointment.rescheduled')
    async handleDoctorRescheduleMail(payload: AppointmentRescheduledEnriched) {
        if (!payload.doctorEmail) return;
        try {
            await this.mailService.sendDoctorRescheduleMail({
                doctorEmail: payload.doctorEmail,
                doctorName: payload.doctorName,
                patientEmail: payload.patientEmail,
                oldScheduledAt: payload.oldScheduledAt,
                newScheduledAt: payload.newScheduledAt,
                newTimeSlotId: payload.newTimeSlotId,
                reason: payload.reason,
            });
        } catch (error) {
            this.logMailError('mail.doctor.appointment.rescheduled', error);
        }
    }

    @OnEvent('mail.coin.expiry.reminder')
    async handleCoinExpiryReminder(payload: CoinExpiryReminderEventPayload) {
        try {
            await this.mailService.sendCoinExpiryReminderMail(payload);
        } catch (error) {
            this.logMailError('mail.coin.expiry.reminder', error);
        }
    }
}
