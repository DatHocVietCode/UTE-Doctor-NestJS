import { OnEvent } from "@nestjs/event-emitter";
import { WebSocketGateway } from "@nestjs/websockets";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { SocketEventsEnum } from "src/common/enum/socket-events.enum";
import { PatientProfileDTO } from "src/patient/dto/patient.dto";
import { BaseGateway } from "../base/base.gateway";
import { PresenceService } from "../presence.service";
import { SocketRoomService } from "../socket.service";


@WebSocketGateway({ cors: true, namespace: '/patient-profile' })
export class PatientProfileGateway extends BaseGateway {
    constructor(socketRoomService: SocketRoomService, presenceService: PresenceService) {
        super(socketRoomService, presenceService);
    }

    // Listen for events to push patient profile
    @OnEvent('socket.push.patient-profile')
    handlePushPatientProfile(payload: { patientProfile: PatientProfileDTO; roomEmail: string }) {
        if (!payload?.patientProfile || !payload?.roomEmail) {
            console.warn('[Socket] Invalid patient profile payload');
            return;
        }

        const dataRes: DataResponse<PatientProfileDTO> = {
            code: ResponseCode.SUCCESS,
            message: 'Patient profile received successfully',
            data: payload.patientProfile,
        };

        this.server
        .to(payload.roomEmail)
        .emit(SocketEventsEnum.PATIENT_PROFILE, dataRes);

        console.log('[Socket] Patient profile pushed to room:', payload.roomEmail);
        //console.log('[Socket] Data pushed', dataRes)
    }
}
