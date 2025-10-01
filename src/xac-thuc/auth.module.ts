import { Module, forwardRef } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { MongooseModule } from "@nestjs/mongoose";
import { UsersModule } from "src/account/account.module";
import { User, UserSchema } from "src/account/schemas/account.schema";
import { MailModule } from "src/mail/mail.module";
import { OtpModule } from "src/utils/otp/otp.module";
import { AuthController } from "./xac-thuc.controller";
import { AuthService } from "./xac-thuc.service";

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
