import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Profile, ProfileDocument } from 'src/profile/schema/profile.schema';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { Doctor, DoctorDocument } from './schema/doctor.schema';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import Fuse from 'fuse.js';
import { emitTyped } from 'src/utils/helpers/event.helper';
import { TimeSlotDto } from 'src/timeslot/dtos/timeslot.dto';
import { TimeSlotStatusEnum } from 'src/timeslot/enums/timeslot-status.enum';


@Injectable()
export class DoctorService {
  constructor(
    @InjectModel(Doctor.name) private readonly doctorModel: Model<DoctorDocument>,
    private readonly eventEmitter: EventEmitter2
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

  @OnEvent('doctor.check.exist')
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


  async searchDoctors(filter: { specialtyId?: string; keyword?: string }) {
    const { specialtyId, keyword } = filter;
    const query: any = {};
    
    console.log('Filtering doctors by specialtyId:', specialtyId, 'and keyword:', keyword);

    // Lọc theo chuyên khoa nếu có
    if (specialtyId) {
      query.chuyenKhoaId = specialtyId;
    }

    // Lấy tất cả doctors theo query và populate profile
    const doctors = await this.doctorModel
      .find(query)
      .populate({
        path: 'profileId',
        model: Profile.name,
        select: 'name email',
      })
      .lean() // Quan trọng: convert sang plain object để Fuse.js hoạt động tốt
      .exec();

    // Format data
    const formattedDoctors = doctors.map((d) => ({
      id: d._id.toString(),
      name: d.profileId?.['name'] || 'N/A',
      email: d.profileId?.['email'] || 'N/A',
      specialtyId: d.chuyenKhoaId?.toString() || null,
      // Giữ nguyên object gốc nếu cần thêm thông tin
      raw: d,
    }));

    // Nếu KHÔNG có keyword → trả về tất cả
    if (!keyword) {
      return {
        code: rc.SUCCESS,
        message: 'Fetched doctors successfully',
        data: formattedDoctors,
      };
    }

    // Nếu CÓ keyword → dùng Fuse.js fuzzy search
    const fuse = new Fuse(formattedDoctors, {
      keys: [
        { name: 'name', weight: 0.7 },      // Ưu tiên tìm theo tên
        { name: 'email', weight: 0.3 },     // Tìm theo email ít quan trọng hơn
      ],
      threshold: 0.4,           // 0 = exact match, 1 = match anything
                                // 0.4 = cho phép sai ~40% (cân bằng)
      includeScore: true,       // Trả về điểm tương đồng
      minMatchCharLength: 1,    // Tối thiểu 2 ký tự mới bắt đầu search
      ignoreLocation: true,     // Không quan tâm vị trí của keyword trong chuỗi
      findAllMatches: true,     // Tìm tất cả matches, không dừng ở match đầu tiên
    });

    const searchResults = fuse.search(keyword);

    // Format kết quả
    const data = searchResults.map((result) => ({
      ...result.item,
      matchScore: result.score,  // 0 = perfect match, 1 = worst match
      // Không cần raw nữa vì đã format
      raw: undefined,
    }));

    return {
      code: rc.SUCCESS,
      message: `Found ${data.length} doctors matching "${keyword}"`,
      data,
    };
  }

  async getTimeSlotsByDoctorAndDate(
    doctorId: string,
    date: string,
    slotStatus: TimeSlotStatusEnum
  ): Promise<DataResponse<TimeSlotDto[]>> {

    // Emit event thay cho logic trực tiếp
    const result = await emitTyped<
      { doctorId: string; date: string; slotStatus?: TimeSlotStatusEnum },
      TimeSlotDto[]
    >(
      this.eventEmitter,
      "doctor.timeslot.query",
      { doctorId, date, slotStatus } // slotStatus có thể undefined
    );

    console.log("[DoctorService] Lấy timeSlots cho bác sĩ:", doctorId, "ngày:", date, "với status:", slotStatus, "→", result);

    return {
      code: rc.SUCCESS,
      message: 'Fetched time slots successfully',
      data: result ?? [],
    };
  }

}
