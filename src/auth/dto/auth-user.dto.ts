import { MedicalRecord } from "src/users/schemas/user.schema";

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