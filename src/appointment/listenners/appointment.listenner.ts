import { Injectable } from "@nestjs/common";
import { AppointmentService } from "../appointment.service";
import { OnEvent } from "@nestjs/event-emitter";

@Injectable()
export class AppointmentListenner {
    constructor (private readonly appointmentService: AppointmentService) {}
    @OnEvent('appointment.get.byId')
    async handleGetAppointmentByIdEvent(appointmentId: string ) {
        return await this.appointmentService.getAppointmentById(appointmentId);
    }
}