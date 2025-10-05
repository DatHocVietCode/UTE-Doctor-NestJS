import { MedicalRecord } from "src/patient/schema/medical-record.schema";


export class RegisterUserReqDto {
    email: string;
    password: string;
    role: "PATIENT" | "DOCTOR";

    medicalRecord?: MedicalRecord;

    chuyenKhoaId: string;
    degree?: string;
    yearsOfExperience?: number;
}

export class LoginUserReqDto {
    email: string;
    password: string;
}

export class LoginUserResDto {
  accessToken: string;
  refreshToken: string;
  role: string;
  id: string;
}
