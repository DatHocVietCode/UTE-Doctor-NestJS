import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreatePatientDto } from './dto/create-patient.dto';
import { Patient, PatientDocument } from './schema/patient.schema';
import { DataResponse } from 'src/common/dto/data-respone';
import { PatientProfileDTO } from './dto/patient.dto';
import { AccountService } from 'src/account/account.service';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';

@Injectable()
export class PatientService {
  constructor(
    @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
    private readonly accountService: AccountService
  ) {}

  async createPatient(createPatientDto: CreatePatientDto): Promise<Patient> {
    const newPatient = new this.patientModel(createPatientDto);
    return newPatient.save();
  }

  async getPatientByEmail(email: string): Promise<DataResponse<PatientProfileDTO | null>> {
    // Gọi sang AccountService
    const accountRes = await this.accountService.getUserByEmail(email);

    if (accountRes.code !== rc.SUCCESS || !accountRes.data) {
      return {
        ...accountRes, // giữ nguyên code + message từ account
        data: null,
      };
    }

    // Tìm Patient gắn với account
    const patient = await this.patientModel.findOne({ accountId: accountRes.data.id }).lean();

    if (!patient) {
      return {
        message: "Patient not found!",
        code: rc.ACCOUNT_NOT_FOUND,
        data: null,
      };
    }

    const patientProfile: PatientProfileDTO = {
      ...accountRes.data,
      medicalRecord: patient.medicalRecord || null,
    };

    return {
      message: "Patient profile received successfully",
      code: rc.SUCCESS,
      data: patientProfile,
    };
  }

}
