import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode } from "src/common/enum/reponse-code.enum";
import { ProfileDocument } from "src/profile/schema/profile.schema";
import { DoctorService } from "../doctor.service";
import { Doctor } from "../schema/doctor.schema";

@Injectable()
export class DoctorListener {
    constructor(private readonly doctorService: DoctorService) {}

    @OnEvent('doctor.get.profile')
    async handleGetDoctorProfileEvent(doctorId: string) : Promise<DataResponse<ProfileDocument | null>> {
        // Xử lý sự kiện lấy profile bác sĩ
        console.log(`[DoctorListener] Yêu cầu lấy profile cho bác sĩ: ${doctorId}`);
        return await this.doctorService.getDoctorProfile(doctorId);
    }

    @OnEvent('doctor.get.byId')
    async handleGetDoctorByIdEvent(doctorId: string) : Promise<Doctor| null> {
        // Xử lý sự kiện lấy bác sĩ theo ID
        console.log(`[DoctorListener] Yêu cầu lấy bác sĩ theo ID: ${doctorId}`);
       
       const doctor = await this.doctorService.findById(doctorId);
        
        return doctor;
    }
}