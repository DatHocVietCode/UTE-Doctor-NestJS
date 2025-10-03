import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreatePatientDto } from './dto/create-patient.dto';
import { Patient, PatientDocument } from './schema/patient.schema';
import { Profile, ProfileDocument } from 'src/profile/schema/profile.schema';

@Injectable()
export class PatientService {
  constructor(
    @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
    @InjectModel(Profile.name) private readonly profileModel: Model<ProfileDocument>,
  ) {}

  async create(createPatientDto: CreatePatientDto): Promise<Patient> {
    const profile = await this.profileModel.create({});
    const patient = new this.patientModel({
      ...createPatientDto,
      profileId: profile._id,
    });
    return patient.save();

  }
}
