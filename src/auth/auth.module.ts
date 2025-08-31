import { Module, forwardRef } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { MongooseModule } from "@nestjs/mongoose";
import { MailModule } from "src/mail/mail.module";
import { User, UserSchema } from "src/users/schemas/user.schema";
import { UsersModule } from "src/users/users.module";
import { OtpUtils } from "src/utils/otp/otp-utils";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { OtpModule } from "src/utils/otp/otp.module";

@Module({
  imports: [
    forwardRef(() => UsersModule), // dùng forwardRef để tránh circular dependency
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN }
    }),
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    MailModule,
    OtpModule
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService]
})
export class AuthModule {}
