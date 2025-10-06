import { IsEmail, IsEnum, IsOptional, IsString } from "class-validator";
import { RoleEnum } from "src/common/enum/role.enum";

export class RegisterUserReqDto {
    @IsEmail()
    email: string;

    @IsString()
    password: string;

    @IsEnum(RoleEnum)
    @IsOptional()
    role: RoleEnum = RoleEnum.PATIENT;
}

export class LoginUserReqDto {
    @IsEmail()
    email: string;

    @IsString()
    password: string;
}

export class LoginUserResDto {
  accessToken: string;
  refreshToken: string;
  role: string;
  id: string;
}
