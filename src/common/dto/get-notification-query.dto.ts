import { IsEmail } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';

export class GetNotificationsQueryDto extends PaginationQueryDto {
  @IsEmail()
  email: string;
}
