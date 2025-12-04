import { IsEnum, IsNotEmpty } from "class-validator";
import { AccountStatusEnum } from "src/common/enum/account-status.enum";

export class UpdateAccountStatusDto {
  @IsNotEmpty()
  @IsEnum(AccountStatusEnum)
  status: AccountStatusEnum;
}
