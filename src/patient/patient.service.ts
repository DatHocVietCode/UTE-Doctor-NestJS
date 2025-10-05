import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountService } from 'src/account/account.service';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { Profile, ProfileDocument } from 'src/profile/schema/profile.schema';
import { CreatePatientDto } from './dto/create-patient.dto';
import { PatientProfileDTO } from './dto/patient.dto';
import { Patient, PatientDocument } from './schema/patient.schema';

@Injectable()
export class PatientService {
  constructor(
    @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
    @InjectModel(Profile.name) private readonly profileModel: Model<ProfileDocument>,
	  private readonly accountService: AccountService
  ) {}

  	//  async create(createPatientDto: CreatePatientDto): Promise<Patient> {
		//  const newPatient = new this.patientModel(createPatientDto);
	  //   return newPatient.save();
	  //   const profile = await this.profileModel.create({});
	  //   const patient = new this.patientModel({
	  //     ...createPatientDto,
	  //     profileId: profile._id,
	  //   });
	  //   return patient.save();

	  // }

	@OnEvent('patient.createPatient')
  async createPatient(createPatientDto: CreatePatientDto): Promise<DataResponse<Patient>> {
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
    // G?i sang AccountService
    const accountRes = await this.accountService.getUserByEmail(email);

    if (accountRes.code !== rc.SUCCESS || !accountRes.data) {
      return {
        ...accountRes, // gi? nguy�n code + message t? account
        data: null,
      };
    }

    // T�m Patient g?n v?i account
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
