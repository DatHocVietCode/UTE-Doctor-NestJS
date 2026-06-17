import { IsEnum } from 'class-validator';
import { VisitStatus } from '../enums/visit-status.enum';

export class UpdateVisitStatusDto {
  @IsEnum(VisitStatus)
  status!: VisitStatus;
}
