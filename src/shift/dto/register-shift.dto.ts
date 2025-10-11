import { IsString, IsNotEmpty, IsIn } from 'class-validator';

export class RegisterShiftDto {
  @IsString()
  @IsNotEmpty()
  doctorId: string;

  @IsString()
  @IsNotEmpty()
  date: string; // Định dạng: YYYY-MM-DD

  @IsString()
  @IsIn(['morning', 'afternoon', 'extra'])
  shift: 'morning' | 'afternoon' | 'extra';
}
