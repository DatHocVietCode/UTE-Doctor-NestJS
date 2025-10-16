import { SubscribeMessage, WebSocketGateway } from "@nestjs/websockets";
import { OnEvent } from "@nestjs/event-emitter";
import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { SocketEventsEnum } from "src/common/enum/socket-events.enum";
import { BaseGateway } from "../base/base.gateway";
import { SocketRoomService } from "../socket.service";
import { PatientProfileDTO } from "src/patient/dto/patient.dto";
import { Socket } from "socket.io";


@WebSocketGateway({ cors: true, namespace: '/patient-profile' })
export class PatientProfileGateway extends BaseGateway {
    constructor(socketRoomService: SocketRoomService) {
        super(socketRoomService);
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
        console.log('[Socket] Data pushed', dataRes)
    }
}
