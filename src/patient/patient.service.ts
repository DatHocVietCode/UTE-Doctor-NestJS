import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { RoleEnum } from 'src/common/enum/role.enum';
import { Profile, ProfileDocument } from 'src/profile/schema/profile.schema';
import { getProfileByEntity } from 'src/utils/helpers/profile.helper';
import { CreatePatientDto } from './dto/create-patient.dto';
import { PatientProfileDTO } from './dto/patient.dto';
import { Patient, PatientDocument } from './schema/patient.schema';

@Injectable()
export class PatientService {
    
  constructor(
    @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
    @InjectModel(Profile.name) private readonly profileModel: Model<ProfileDocument>,
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
  async getPatientProfileByEmail(email: string) : Promise<DataResponse> {
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

  findById(patientId: string) {
    return this.patientModel.findById(patientId).lean();
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

  async getPatientProfile(patientId: string): Promise<DataResponse<ProfileDocument | null>> {
    const patient = await getProfileByEntity<PatientDocument>(
      this.patientModel,
      patientId
    );
    if (!patient) {
      return {
        code: rc.ERROR,
        message: 'Patient profile not found',
        data: null,
      };
    }
    return {
      code: rc.SUCCESS,
      message: 'Fetched patient profile successfully',
      data: patient,
    };
  }

  async getPatientByEmail(email: string): Promise<Patient | null> {
    // Tìm patient và populate luôn profile
    const patient = await this.patientModel
      .findOne()                      // không filter gì trước
      .populate({
        path: 'profileId',            // populate field profileId
        match: { email },             // filter profile theo email
      })
      .exec();

    // Nếu không có patient hoặc profile bị null do match
    if (!patient || !patient.profileId) {
      console.log('[PatientService] No patient found with email:', email);
      return null;
    }

    console.log('[PatientService] Patient found:', JSON.stringify(patient, null, 2));
    return patient;
  }

  async findByAccountId(accountId: string) {
    return this.patientModel.findOne({ accountId }).populate('profileId').exec();
  }

  async findProfileById(id: string) {
    return this.patientModel
      .findById(id)
      .populate('profileId')   // lấy thông tin Profile
      .exec();
  }

  async findAll(page: number = 1, limit: number = 5, keyword?: string) {
    const skip = (page - 1) * limit;

    let profileFilter = {};

    if (keyword) {
      profileFilter = {
        name: { $regex: keyword, $options: 'i' } // fuzzy search không phân biệt hoa/thường
      };
    }

    const matchedProfiles = await this.profileModel.find(profileFilter, '_id');

    const profileIds = matchedProfiles.map(p => p._id);

    const query: any = {};
    if (keyword) {
      query.profileId = { $in: profileIds };
    }

    const [data, total] = await Promise.all([
      this.patientModel
        .find(query)
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'profileId',
          select: 'name phone email gender dob avatarUrl'
        })
        .populate({
          path: 'accountId',
          select: 'email role status'
        })
        .exec(),

      this.patientModel.countDocuments(query),
    ]);

    return {
      code: 200,
      message: 'Get patients successfully',
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

}
