import { AccountProfileDto } from "src/account/dto/account.dto";
import { AllergyRecord, MedicalEncounter, MedicalHistoryRecord, MedicalProfile, MedicalRecord } from "../schema/medical-record.schema";


export interface PatientProfileDTO  {
    accountProfileDto: AccountProfileDto
    medicalRecord: MedicalRecord | null // legacy for backward compatibility
    medicalProfile?: MedicalProfile | null
    encounters?: MedicalEncounter[]
    allergies?: AllergyRecord[]
    medicalHistory?: MedicalHistoryRecord[]
}