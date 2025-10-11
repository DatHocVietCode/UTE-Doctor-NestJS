import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";

@Injectable()
export class NotificationService {
    @OnEvent('patient.notify')
    pushPatientNotification(email: string) { } // TODO: implement later

    @OnEvent('doctor.notify')
    pushDoctorNotification(doctorId: string) { } // TODO: implement later
}

