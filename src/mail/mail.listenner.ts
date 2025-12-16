import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { AppointmentEnriched } from "src/appointment/schemas/appointment-enriched";
import { MailService } from "./mail.service";


@Injectable()
export class MailListener {
    constructor(private readonly mailService: MailService) {}

    @OnEvent('mail.patient.booking.success')
    handlePatientBookingMail(payload: AppointmentEnriched) {
       this.mailService.sendPatientBookingSuccessMail(payload);
    }

    @OnEvent('mail.doctor.booking.success')
    handleDoctorBookingMail(payload: AppointmentEnriched) {
        this.mailService.sendDoctorBookingSuccessMail(payload);
    }

    @OnEvent('mail.patient.shift.cancelled')
    handlePatientShiftCancelled(payload: {
        patientEmail: string;
        doctorName?: string;
        date: string;
        timeSlot: string;
        hospitalName?: string;
        reason?: string;
    }) {
        this.mailService.sendPatientShiftCancellationMail(payload);
    }

    @OnEvent('mail.doctor.shift.cancelled')
    handleDoctorShiftCancelled(payload: {
        doctorEmail: string;
        doctorName?: string;
        date: string;
        shift: string;
        reason?: string;
        affectedAppointmentsCount: number;
    }) {
        this.mailService.sendDoctorShiftCancellationMail(payload);
    }
}