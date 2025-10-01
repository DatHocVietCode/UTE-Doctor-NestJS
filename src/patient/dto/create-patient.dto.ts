import { BloodType } from "src/common/enum/blood-type.enum";
import { MedicalRecord } from "../schema/medical-record.schema";

export class CreatePatientDto {
  accountId: string;   // ObjectId dưới dạng string khi nhận từ client

  height?: number;

  weight?: number;

  bloodType?: BloodType;

  medicalRecord?: MedicalRecord;
}
