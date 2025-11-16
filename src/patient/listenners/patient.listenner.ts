import { Injectable } from "@nestjs/common";
import { PatientService } from "../patient.service";
import { OnEvent } from "@nestjs/event-emitter";
import { DataResponse } from "src/common/dto/data-respone";
import { ProfileDocument } from "src/profile/schema/profile.schema";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { Patient } from "../schema/patient.schema";


@Injectable()
export class PatientListener {
    constructor (private readonly patientService: PatientService) {}

    @OnEvent('patient.get.profile')
    async handleGetPatientProfileEvent(payload: { patientId: string }) : Promise<DataResponse<ProfileDocument | null>> {
        // Xử lý sự kiện lấy profile bệnh nhân
        console.log(`[PatientListener] Yêu cầu lấy profile cho bệnh nhân: ${payload.patientId}`);
        return await this.patientService.getPatientProfile(payload.patientId);
    }

    @OnEvent('patient.get.byId')
    async handleGetPatientByIdEvent(patientId: string) : Promise<DataResponse<Patient | null>> {
        // Xử lý sự kiện lấy bệnh nhân theo ID
        console.log(`[PatientListener] Yêu cầu lấy bệnh nhân theo ID: ${patientId}`);
       
       const patient = await this.patientService.findById(patientId);
         return {
            code: patient ? ResponseCode.SUCCESS : ResponseCode.NOT_FOUND,
            message: patient ? 'Patient found' : 'Patient not found',
            data: patient
        };
    }
}