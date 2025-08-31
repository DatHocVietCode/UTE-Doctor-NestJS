import { Module } from "@nestjs/common";
import { OtpUtils } from "./otp-utils";

@Module({
    providers: [OtpUtils],
    exports: [OtpUtils]
})

export class OtpModule {}