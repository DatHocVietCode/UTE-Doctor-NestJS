import { IsNotEmpty, IsString } from "class-validator";

export class CreateMedicineDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  packaging: string;
}
