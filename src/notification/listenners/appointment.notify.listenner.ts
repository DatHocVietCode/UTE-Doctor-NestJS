import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import * as appointmentEnriched from "src/appointment/schemas/appointment-enriched";
import { NotificationService } from "../notification.service";


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

    @OnEvent('notify.patient.shift.cancelled')
    handlePatientShiftCancelled(payload: {
        patientEmail: string;
        doctorName?: string;
        date: string;
        timeSlot: string;
        hospitalName?: string;
        reason?: string;
    }) {
        this.notificationService.createPatientShiftCancellationNotification(payload);
    }

    @OnEvent('notify.doctor.shift.cancelled')
    handleDoctorShiftCancelled(payload: {
        doctorEmail: string;
        date: string;
        shift: string;
        reason?: string;
        affectedAppointmentsCount: number;
    }) {
        this.notificationService.createDoctorShiftCancellationNotification(payload);
    }
}