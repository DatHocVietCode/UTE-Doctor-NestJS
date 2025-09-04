export class RegisterUserDto {
    email: string;
    password: string;
    fullName: string;
    dob: Date;
    phoneNumber: string;
}

export class LoginUserReqDto {
    email: string;
    password: string;
}

export class LoginUserResDto {
    accessToken: string;
    refreshToken: string;
}