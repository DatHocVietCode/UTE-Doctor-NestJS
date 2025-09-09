import { GenderEnum } from "src/common/enum/gender-enum";

export class RegisterUserDto {
    email: string;
    password: string;
    fullName: string;
    dob: Date;
    phoneNumber: string;
    gender: GenderEnum;
}

export class LoginUserReqDto {
    email: string;
    password: string;
}

export class LoginUserResDto {
    accessToken: string;
    refreshToken: string;
}