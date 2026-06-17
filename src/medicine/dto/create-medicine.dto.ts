import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateMedicineDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  packaging: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitPrice?: number;
}
