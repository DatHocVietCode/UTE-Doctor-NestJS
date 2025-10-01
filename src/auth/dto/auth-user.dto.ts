import { MedicalRecord } from "src/patient/schema/medical-record.schema";


export class RegisterUserReqDto {
    email: string;
    password: string;
    medicalRecord: MedicalRecord | null;
}

export class LoginUserReqDto {
    email: string;
    password: string;
}

export class LoginUserResDto {
    accessToken: string;
    refreshToken: string;
}