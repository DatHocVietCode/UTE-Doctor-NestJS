import { Module, forwardRef } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { MongooseModule } from "@nestjs/mongoose";
import { AccountModule } from "src/account/account.module";
import { Account, AccountSchema } from "src/account/schemas/account.schema";
import { MailModule } from "src/mail/mail.module";
import { OtpModule } from "src/utils/otp/otp.module";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";

@Module({
  imports: [
    forwardRef(() => AccountModule), // dùng forwardRef để tránh circular dependency
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN }
    }),
    MongooseModule.forFeature([{ name: Account.name, schema: AccountSchema }]),
    MailModule,
    OtpModule
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService]
})
export class AuthModule {}
