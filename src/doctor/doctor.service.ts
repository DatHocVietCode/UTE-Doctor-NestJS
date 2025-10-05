import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Profile, ProfileDocument } from 'src/profile/schema/profile.schema';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { Doctor, DoctorDocument } from './schema/doctor.schema';

@Injectable()
export class DoctorService {
  constructor(
    @InjectModel(Doctor.name) private readonly doctorModel: Model<DoctorDocument>,
    @InjectModel(Profile.name) private readonly profileModel: Model<ProfileDocument>,
  ) {}

  @OnEvent('doctor.createDoctor')
  async create(createDoctorDto: CreateDoctorDto): Promise<Doctor> {
    const profile = await this.profileModel.create({});
    const doctor = new this.doctorModel({
    profileId: profile._id,   
    ...createDoctorDto,      
    });
    console.log(doctor.profileId);
    return doctor.save();

  }

  async findAll(): Promise<Doctor[]> {
    return this.doctorModel.find().populate('accountId').populate('chuyenKhoaId').exec();
  }

  async findById(id: string): Promise<Doctor | null> {
    return this.doctorModel.findById(id).populate('accountId').populate('chuyenKhoaId').exec();
  }
}
