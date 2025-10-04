import { AccountProfileDTO } from "src/account/dto/account.dto";
import { MedicalRecord } from "../schema/medical-record.schema";

export interface PatientProfileDTO extends AccountProfileDTO {
    medicalRecord: MedicalRecord | null
}