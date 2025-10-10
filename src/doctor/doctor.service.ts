import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Profile, ProfileDocument } from 'src/profile/schema/profile.schema';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { Doctor, DoctorDocument } from './schema/doctor.schema';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';

@Injectable()
export class DoctorService {
  constructor(
    @InjectModel(Doctor.name) private readonly doctorModel: Model<DoctorDocument>,
  ) {}

  @OnEvent('doctor.createDoctor')
  async createDoctor(createDoctorDto: CreateDoctorDto): Promise<DataResponse<Doctor>> {
    const dataRes: DataResponse<Doctor> = {
      code: rc.PENDING,
      message: '',
      data: null,
    };

    try {
      // Tạo bác sĩ mới, KHÔNG tạo profile
      const doctor = new this.doctorModel(createDoctorDto);
      const savedDoctor = await doctor.save();

      dataRes.code = rc.SUCCESS;
      dataRes.message = 'Doctor created successfully!';
      dataRes.data = savedDoctor;

      console.log('[DoctorListener]: Created doctor →', savedDoctor._id.toString());
    } catch (error) {
      dataRes.code = rc.ERROR;
      dataRes.message = `Error creating doctor: ${error.message}`;
      console.error('[DoctorListener]: Error →', error.message);
    }

    return dataRes;
  }

  @OnEvent('doctor.check.exist', { async: true })
  async handleDoctorExist(payload: { doctorId: string }): Promise<boolean> {
    try {
      const exists = await this.doctorModel.exists({ _id: payload.doctorId });
      console.log(
        `[DoctorService]: Kiểm tra tồn tại bác sĩ ${payload.doctorId} →`,
        !!exists,
      );
      return !!exists;
    } catch (error) {
      console.error(
        '[DoctorService]: Lỗi khi kiểm tra tồn tại bác sĩ →',
        error.message,
      );
      return false;
    }
  }

  async findAll(): Promise<Doctor[]> {
    return this.doctorModel.find().populate('accountId').populate('chuyenKhoaId').exec();
  }

  async findById(id: string): Promise<Doctor | null> {
    return this.doctorModel.findById(id).populate('accountId').populate('chuyenKhoaId').exec();
  }
}
