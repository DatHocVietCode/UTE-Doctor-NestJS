import { IsString, IsNotEmpty, IsIn } from 'class-validator';

export class RegisterShiftRequestDto {
  @IsString()
  @IsNotEmpty()
  date: string; // Ð?nh d?ng: YYYY-MM-DD

  @IsString()
  @IsIn(['morning', 'afternoon', 'extra'])
  shift: 'morning' | 'afternoon' | 'extra';
}

export class RegisterShiftDto extends RegisterShiftRequestDto {
  @IsString()
  @IsNotEmpty()
  doctorId: string;
}