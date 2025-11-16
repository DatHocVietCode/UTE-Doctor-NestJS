import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { AppointmentBookingDto } from "src/appointment/dto/appointment-booking.dto";
import { NotificationService } from "../notification.service";
import type { AppointmentDocument } from "src/appointment/schemas/appointment.schema";
import * as appointmentEnriched from "src/appointment/schemas/appointment-enriched";
import { App } from "supertest/types";


@Injectable()
export class AppointmentNotificationListener
{
    constructor (private readonly notificationService: NotificationService,
                private readonly eventEmitter: EventEmitter2
    ) {}

    @OnEvent('notify.patient.booking.success')
    handlePatientNotification(payload: appointmentEnriched.AppointmentEnriched) {
        this.notificationService.createPatientAppointmentNotification(payload);
    }

    @OnEvent('notify.doctor.booking.success')
    handleDoctorNotification(payload: appointmentEnriched.AppointmentEnriched) {
        this.notificationService.createDoctorAppointmentNotification(payload);
    }
}