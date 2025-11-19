import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { MailService } from "./mail.service";
import type { AppointmentEnriched } from "src/appointment/schemas/appointment-enriched";


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
}