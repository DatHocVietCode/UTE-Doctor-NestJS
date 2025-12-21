import { IsEnum } from 'class-validator';

export enum DoctorPostStatus {
  ACTIVE = 'ACTIVE',
  HIDDEN = 'HIDDEN',
}

export class UpdateDoctorPostStatusDto {
  @IsEnum(DoctorPostStatus)
  status: DoctorPostStatus;
}
