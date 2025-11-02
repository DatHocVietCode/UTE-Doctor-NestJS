import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { AppointmentBookingDto } from "src/appointment/dto/appointment-booking.dto";
import { MailService } from "./mail.service";


@Injectable()
export class MailListener {
    constructor(private readonly mailService: MailService) {}

    @OnEvent('mail.patient.booking.success')
    handlePatientBookingMail(payload: AppointmentBookingDto) {
       this.mailService.sendPatientBookingSuccessMail(payload);
    }

    @OnEvent('mail.doctor.booking.success')
    handleDoctorBookingMail(payload: AppointmentBookingDto) {
        this.mailService.sendDoctorBookingSuccessMail(payload);
    }
}