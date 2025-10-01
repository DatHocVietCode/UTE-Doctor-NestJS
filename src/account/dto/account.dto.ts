import { AccountStatusEnum } from "src/common/enum/account-status.enum";
import { GenderEnum } from "src/common/enum/gender.enum";
import { MedicalRecord } from "src/patient/schema/medical-record.schema";


export interface updateUAccountDto {
    fullName?: string;
    email?: string;
    password?: string;
    role?: string;
}

export interface AccountProfileDTO {
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
}