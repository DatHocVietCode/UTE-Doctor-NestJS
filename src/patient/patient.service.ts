import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountService } from 'src/account/account.service';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { CreatePatientDto } from './dto/create-patient.dto';
import { PatientProfileDTO } from './dto/patient.dto';
import { Patient, PatientDocument } from './schema/patient.schema';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class PatientService {
  constructor(
    @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
    private readonly accountService: AccountService
  ) {}

  @OnEvent('patient.createPatient')
  async createPatient(createPatientDto: CreatePatientDto): Promise<DataResponse<Patient>> {
    console.log("Heard createPatient event")
    let dataRes: DataResponse<Patient> = {
      code: rc.PENDING,
      message: "",
      data: null
    }
    const existPatient = await this.patientModel.findOne({id: createPatientDto.accountId});
    if (existPatient)
    {
      dataRes.code = rc.ERROR,
      dataRes.message = "Patient existed!"
      dataRes.data = null
      return dataRes;
    }
    const newPatient = new this.patientModel(createPatientDto);
    const savedPatient = await newPatient.save();

    dataRes.code = rc.SUCCESS;
    dataRes.message = "Patient created successfully!";
    dataRes.data = savedPatient;
    return dataRes;
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
