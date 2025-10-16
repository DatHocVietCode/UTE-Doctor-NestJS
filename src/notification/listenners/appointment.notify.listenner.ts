import { Injectable } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { AppointmentBookingDto } from "src/appointment/dto/appointment-booking.dto";
import { NotificationService } from "../notification.service";


@Injectable()
export class AppointmentNotificationListener
{
    constructor (private readonly notificationService: NotificationService,
                private readonly eventEmitter: EventEmitter2
    ) {}

    @OnEvent('notify.patient.booking.success')
    handlePatientNotification(payload: AppointmentBookingDto) {
        this.notificationService.createPatientAppointmentNotification(payload);
    }

    @OnEvent('notify.doctor.booking.success')
    handleDoctorNotification(payload: AppointmentBookingDto) {
        this.notificationService.createDoctorAppointmentNotification(payload);
    }
}