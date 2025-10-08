import { AccountProfileDto } from "src/account/dto/account.dto";
import { MedicalRecord } from "../schema/medical-record.schema";


export interface PatientProfileDTO  {
    accountProfileDto: AccountProfileDto
    medicalRecord: MedicalRecord | null
}