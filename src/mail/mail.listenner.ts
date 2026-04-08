import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { AppointmentEnriched } from "src/appointment/schemas/appointment-enriched";
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
    }) {
        try {
            await this.mailService.sendPatientAppointmentCancellationMail(payload);
        } catch (error) {
            this.logMailError('mail.patient.appointment.cancelled', error);
        }
    }
}