import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { DataResponse } from 'src/common/dto/data-respone';
import { CreatePatientDto } from './dto/create-patient.dto';
import { PatientProfileDTO } from './dto/patient.dto';
import { Patient, PatientDocument } from './schema/patient.schema';
import { RoleEnum } from 'src/common/enum/role.enum';

@Injectable()
export class PatientService {
  constructor(
    @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
    private readonly eventEmitter: EventEmitter2
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
    console.log("In create patient")
    let dataRes: DataResponse<Patient> = {
      code: rc.PENDING,
      message: "",
      data: null
    }
    
    const newPatient = new this.patientModel(createPatientDto);
    const savedPatient = await newPatient.save();

    dataRes.code = rc.SUCCESS;
    dataRes.message = "Patient created successfully!";
    dataRes.data = savedPatient;

    console.log(dataRes.message)
    return dataRes;
  }
  async getPatientByEmail(email: string) : Promise<DataResponse> {
    const res : DataResponse = {
      code: rc.PENDING,
      message: "Server received request!",
      data: null
    }
    this.eventEmitter.emit('profile.get', { email: email , role: RoleEnum.PATIENT });
    return res;
  }
  // async getPatientByEmail(email: string): Promise<DataResponse<PatientProfileDTO | null>> {
  //   // G?i sang AccountService
  //   const accountRes = await this.accountService.getUserByEmail(email);

  //   if (accountRes.code !== rc.SUCCESS || !accountRes.data) {
  //     return {
  //       ...accountRes, // gi? nguy�n code + message t? account
  //       data: null,
  //     };
  //   }

  //   // T�m Patient g?n v?i account
  //   const patient = await this.patientModel.findOne({ accountId: accountRes.data.id }).lean();

  //   if (!patient) {
  //     return {
  //       message: "Patient not found!",
  //       code: rc.ACCOUNT_NOT_FOUND,
  //       data: null,
  //     };
  //   }

  //   const patientProfile: PatientProfileDTO = {
  //     ...accountRes.data,
  //     medicalRecord: patient.medicalRecord || null,
  //   };

  //   return {
  //     message: "Patient profile received successfully",
  //     code: rc.SUCCESS,
  //     data: patientProfile,
  //   };
  // }

   async findByProfileId(profileId: string): Promise<Patient | null> {
    return this.patientModel
      .findOne({ profileId: new mongoose.Types.ObjectId(profileId) })
      .lean(); // chỉ cần data thô
  }

 @OnEvent('patient.getByProfileId')
  async handleGetPatientByProfileId(payload: { profileId: string }): Promise<PatientProfileDTO | null> {
    const patient = await this.findByProfileId(payload.profileId);
    if (!patient) {
      console.warn(`[PatientSubscriber] No patient found for profileId: ${payload.profileId}`);
      return null;
    }

    const dto: PatientProfileDTO = {
      accountProfileDto: null!, // Sẽ được Saga gán lại
      medicalRecord: patient.medicalRecord || null
    };

    // Log đẹp, không còn [Object]
    console.log("[PatientSubscriber] Patient info fetched:", JSON.stringify(dto, null, 2));
    
    return dto;
  }

}
