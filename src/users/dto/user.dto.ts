import { AccountStatusEnum } from "src/common/enum/account-status.enum";
import { GenderEnum } from "src/common/enum/gender.enum";
import { MedicalRecordDto } from "./medical-record.dto";

export interface updateUserDto {
    fullName?: string;
    email?: string;
    password?: string;
    role?: string;
}

export interface UserProfileDTO {
  id?: string;
  name: string;
  email: string;
  phoneNumber?: string;
  dateOfBirth?: Date;
  avatarUrl?: string;
  address?: string;
  gender?: GenderEnum;
  status: AccountStatusEnum;
  createdAt: Date;
  updatedAt: Date;
  medicalRecord: MedicalRecordDto | null;
}