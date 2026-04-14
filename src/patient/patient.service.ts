import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { Account, AccountDocument } from 'src/account/schemas/account.schema';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { RoleEnum } from 'src/common/enum/role.enum';
import { Profile, ProfileDocument } from 'src/profile/schema/profile.schema';
import { getProfileByEntity } from 'src/utils/helpers/profile.helper';
import { AuthUser } from 'src/common/interfaces/auth-user';
import { CreatePatientDto } from './dto/create-patient.dto';
import { PatientProfileDTO } from './dto/patient.dto';
import {
  AllergyRecord,
  AllergyRecordDocument,
  MedicalEncounter,
  MedicalEncounterDocument,
  MedicalHistoryRecord,
  MedicalHistoryRecordDocument,
  MedicalProfile,
  MedicalProfileDocument
} from './schema/medical-record.schema';
import { Patient, PatientDocument } from './schema/patient.schema';

@Injectable()
export class PatientService {
    
  constructor(
    @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
    @InjectModel(Profile.name) private readonly profileModel: Model<ProfileDocument>,
    @InjectModel(Account.name) private readonly accountModel: Model<AccountDocument>,
    @InjectModel(MedicalProfile.name) private readonly medicalProfileModel: Model<MedicalProfileDocument>,
    @InjectModel(AllergyRecord.name) private readonly allergyRecordModel: Model<AllergyRecordDocument>,
    @InjectModel(MedicalHistoryRecord.name) private readonly medicalHistoryRecordModel: Model<MedicalHistoryRecordDocument>,
    @InjectModel(MedicalEncounter.name) private readonly medicalEncounterModel: Model<MedicalEncounterDocument>,

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
  async getPatientProfileByUser(user: AuthUser) : Promise<DataResponse> {
    const res : DataResponse = {
      code: rc.PENDING,
      message: "Server received request!",
      data: null
    }
    const email = user?.email;
    if (!email) {
      return {
        code: rc.ERROR,
        message: "Email is required",
        data: null,
      };
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
      .populate('medicalProfileId') // populate new profile if exists
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

    const patientId = (patient as any)._id;

    // Fetch from new separated collections
    const [medicalProfile, encounters, allergies, medicalHistory] = await Promise.all([
      patient.medicalProfileId 
        ? this.medicalProfileModel.findById(patient.medicalProfileId).lean()
        : null,
      this.medicalEncounterModel.find({ patientId }).lean(),
      this.allergyRecordModel.find({ patientId }).lean(),
      this.medicalHistoryRecordModel.find({ patientId }).lean(),
    ]);

    const dto: PatientProfileDTO = {
      accountProfileDto: null!, // Sẽ được Saga gán lại
      medicalRecord: patient.medicalRecord || null, // legacy for backward compatibility
      medicalProfile: medicalProfile as any,
      encounters: encounters as any[],
      allergies: allergies as any[],
      medicalHistory: medicalHistory as any[],
    };

    console.log("[PatientSubscriber] Patient info fetched with new collections:", JSON.stringify(dto, null, 2));
    
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
    // Step 1: Tìm profile theo email trước
    const profile = await this.profileModel.findOne({ email }).lean();
    
    if (!profile) {
      console.log('[PatientService] No profile found with email:', email);
      return null;
    }

    // Step 2: Dùng profileId để tìm patient
    const patient = await this.patientModel
      .findOne({ profileId: profile._id })
      .populate('profileId')
      .exec();

    if (!patient) {
      console.log('[PatientService] No patient found for profileId:', profile._id);
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

  async upsertMedicalProfile(
    patientId: string,
    payload: Partial<MedicalProfile>,
    user?: AuthUser
  ): Promise<MedicalProfileDocument> {
    const doc = await this.medicalProfileModel.findOneAndUpdate(
      { patientId: new mongoose.Types.ObjectId(patientId) },
      {
        $set: {
          height: payload.height,
          weight: payload.weight,
          bloodType: payload.bloodType,
          createdByRole: payload.createdByRole || RoleEnum.PATIENT,
          createdByAccountId: payload.createdByAccountId || user?.accountId || undefined,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await this.patientModel.updateOne(
      { _id: new mongoose.Types.ObjectId(patientId) },
      { $set: { medicalProfileId: doc._id } }
    );

    return doc;
  }

  async addAllergyRecord(
    patientId: string,
    payload: Partial<AllergyRecord>,
    user?: AuthUser
  ): Promise<AllergyRecordDocument> {
    const doc = await this.allergyRecordModel.create({
      patientId: new mongoose.Types.ObjectId(patientId),
      type: payload.type,
      substance: payload.substance,
      reaction: payload.reaction,
      severity: payload.severity,
      reportedBy: payload.reportedBy || 'PATIENT',
      verifiedByDoctor: payload.verifiedByDoctor ?? false,
      verifiedByDoctorId: payload.verifiedByDoctorId,
      createdByRole: payload.createdByRole || RoleEnum.PATIENT,
      createdByAccountId: payload.createdByAccountId || user?.accountId,
    });
    return doc;
  }

  async addMedicalHistoryRecord(
    patientId: string,
    payload: Partial<MedicalHistoryRecord>,
    user?: AuthUser
  ): Promise<MedicalHistoryRecordDocument> {
    const doc = await this.medicalHistoryRecordModel.create({
      patientId: new mongoose.Types.ObjectId(patientId),
      conditionName: payload.conditionName,
      diagnosisCode: payload.diagnosisCode,
      diagnosedAt: payload.diagnosedAt,
      status: payload.status || 'ONGOING',
      source: payload.source || 'PATIENT',
      verifiedByDoctor: payload.verifiedByDoctor ?? false,
      verifiedByDoctorId: payload.verifiedByDoctorId,
      createdByRole: payload.createdByRole || RoleEnum.PATIENT,
      createdByAccountId: payload.createdByAccountId || user?.accountId,
    });
    return doc;
  }

  async findAll(page: number = 1, limit: number = 5, keyword?: string) {
    const skip = (page - 1) * limit;
    let query: any = {};

    if (keyword) {
      const regex = { $regex: keyword, $options: "i" };

      const matchedProfiles = await this.profileModel.find(
        {
          $or: [
            { name: regex },
            { phone: regex },
            { email: regex },
          ],
        },
        "_id"
      );

      const profileIds = matchedProfiles.map((p) => p._id);

      const matchedAccounts = await this.accountModel.find(
        { email: regex },
        "_id"
      );

      const accountIds = matchedAccounts.map((a) => a._id);

      query = {
        $or: [
          { profileId: { $in: profileIds } },
          { accountId: { $in: accountIds } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      this.patientModel
        .find(query)
        .skip(skip)
        .limit(limit)
        .populate({
          path: "profileId",
          select: "name phone email gender dob avatarUrl",
        })
        .populate({
          path: "accountId",
          select: "email role status",
        })
        .exec(),

      this.patientModel.countDocuments(query),
    ]);

    return {
      code: 200,
      message: "Get patients successfully",
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
