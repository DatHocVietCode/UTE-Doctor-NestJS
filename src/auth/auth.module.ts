import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AccountModule } from "src/account/account.module";
import { Account, AccountSchema } from "src/account/schemas/account.schema";
import { DoctorModule } from "src/doctor/doctor.module";
import { PatientModule } from "src/patient/patient.module";
import { ProfileModule } from "src/profile/profile.module";
import { UserContextModule } from "src/user-context/user-context.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Account.name, schema: AccountSchema }]),
    UserContextModule,
    AccountModule,
    ProfileModule,
    PatientModule,
    DoctorModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService]
})
export class AuthModule {}
