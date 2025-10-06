import { AccountStatusEnum } from "src/common/enum/account-status.enum";
import { GenderEnum } from "src/common/enum/gender.enum";
import { IsOptional, IsString, IsEnum, IsEmail, IsDate } from "class-validator";
import { RoleEnum } from "src/common/enum/role.enum";

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsEnum(RoleEnum)
  role?: RoleEnum;
}

export class AccountProfileDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsDate()
  dateOfBirth?: Date;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsEnum(GenderEnum)
  gender?: GenderEnum;

  @IsEnum(AccountStatusEnum)
  status: AccountStatusEnum;

  @IsDate()
  createdAt: Date;

  @IsDate()
  updatedAt: Date;
}