import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { AccountDocument } from "src/account/schemas/account.schema";
import { RoleEnum } from "src/common/enum/role.enum";
import { Doctor } from "src/doctor/schema/doctor.schema";
import { Patient } from "src/patient/schema/patient.schema";
import { Profile } from "src/profile/schema/profile.schema";

@Injectable()
export class UserContextService {
  constructor(
    @InjectModel(Patient.name) private patientModel: Model<Patient>,
    @InjectModel(Doctor.name) private doctorModel: Model<Doctor>,
    @InjectModel(Profile.name) private profileModel: Model<Profile>,
  ) {}

  async getUserContext(account: AccountDocument) {
    const profile = account.profileId
      ? await this.profileModel.findById(account.profileId).lean()
      : null;

   const patient =
    account.role === RoleEnum.PATIENT
        ? await this.patientModel.findOne({ profileId: account.profileId }).lean() as (Patient & { _id: string }) | null
        : null;

    const doctor =
    account.role === RoleEnum.DOCTOR
        ? await this.doctorModel.findOne({ profileId: account.profileId }).lean() as (Doctor & { _id: string }) | null
        : null;


    return {
      accountId: account._id.toString(),
      role: account.role,
      profileId: account.profileId ?? null,
      patientId: patient?._id ?? null,
      doctorId: doctor?._id ?? null,
      profile: profile ? {
        name: profile.name,
        phone: profile.phone,
        email: profile.email,
      } : null
    };
  }
}
