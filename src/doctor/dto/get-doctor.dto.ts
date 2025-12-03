import { IsOptional, IsString, IsMongoId, IsNumberString } from "class-validator";

export class GetDoctorDto {
  @IsOptional()
  @IsString()
  name?: string;         // tìm theo doctorName

  @IsOptional()
  @IsMongoId()
  chuyenKhoaId?: string; // lọc theo chuyên khoa

  @IsOptional()
  @IsNumberString()
  page?: number;

  @IsOptional()
  @IsNumberString()
  limit?: number;
}
