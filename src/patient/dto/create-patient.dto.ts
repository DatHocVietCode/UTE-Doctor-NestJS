import { BloodType } from "src/common/enum/blood-type.enum";
import { MedicalRecord } from "../schema/medical-record.schema";

export class CreatePatientDto {
  accountId: string;

  height?: number;

  weight?: number;

  bloodType?: BloodType;

  medicalRecord?: MedicalRecord;
}
