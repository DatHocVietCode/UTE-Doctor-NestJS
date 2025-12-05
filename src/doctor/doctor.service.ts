import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import Fuse from 'fuse.js';
import mongoose, { Model, Types } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode as rc } from 'src/common/enum/reponse-code.enum';
import { Profile, ProfileDocument } from 'src/profile/schema/profile.schema';
import { Account, AccountDocument } from 'src/account/schemas/account.schema';
import { MailService } from 'src/mail/mail.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { RoleEnum } from 'src/common/enum/role.enum';
import { AccountStatusEnum } from 'src/common/enum/account-status.enum';
import { TimeSlotDto } from 'src/timeslot/dtos/timeslot.dto';
import { TimeSlotStatusEnum } from 'src/timeslot/enums/timeslot-status.enum';
import { emitTyped } from 'src/utils/helpers/event.helper';
import { getProfileByEntity } from 'src/utils/helpers/profile.helper';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { Doctor, DoctorDocument } from './schema/doctor.schema';
import { UpdateDoctorDto } from 'src/doctor/dto/update-doctor.dto';


@Injectable()
export class DoctorService {
  constructor(
    @InjectModel(Doctor.name) private readonly doctorModel: Model<DoctorDocument>,
    @InjectModel(Profile.name) private readonly profileModel: Model<ProfileDocument>,
    @InjectModel(Account.name) private readonly accountModel: Model<AccountDocument>,
    private readonly eventEmitter: EventEmitter2,
    private readonly mailService: MailService,
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
    return this.doctorModel.findById(id).populate('profileId').populate('chuyenKhoaId').exec();
  }

  async createWithAccount(createDoctorDto: CreateDoctorDto) {
    const dataRes: DataResponse<any> = { code: rc.PENDING, message: '', data: null };

    let profileDoc: any = null;
    let accountDoc: any = null;
    let savedDoctor: any = null;

    try {
      // check email uniqueness
      const email = createDoctorDto.profile?.email;
      if (!email) throw new Error('Doctor email is required');
      const exists = await this.accountModel.exists({ email });
      if (exists) throw new Error('Account with this email already exists');

      // create profile
      profileDoc = await this.profileModel.create({
        name: createDoctorDto.profile.name,
        address: createDoctorDto.profile.address ?? '',
        phone: createDoctorDto.profile.phone ?? '',
        email: createDoctorDto.profile.email,
        gender: createDoctorDto.profile.gender ?? '',
        dob: createDoctorDto.profile.dob ? new Date(createDoctorDto.profile.dob) : null,
        avatarUrl: createDoctorDto.profile.avatarUrl ?? '',
      });

      // generate random password
      const rawPassword = crypto.randomBytes(6).toString('hex');
      const hashed = await bcrypt.hash(rawPassword, 10);

      // create account
      accountDoc = await this.accountModel.create({
        email: email,
        password: hashed,
        role: RoleEnum.DOCTOR,
        profileId: profileDoc._id,
        status: AccountStatusEnum.INACTIVE,
      } as any);

      // prepare doctor fields
      const doctorPayload: any = {
        profileId: profileDoc._id,
        accountId: accountDoc._id,
        doctorName: createDoctorDto.doctorName,
        chuyenKhoaId: createDoctorDto.specialty ? new Types.ObjectId(createDoctorDto.specialty) : undefined,
        bio: createDoctorDto.bio ?? undefined,
        academic: createDoctorDto.academic ?? undefined,
        achievements: createDoctorDto.achievements ?? undefined,
        yearsOfExperience: createDoctorDto.yearsOfExperience ?? undefined,
      };
      if (createDoctorDto.degree) {
        doctorPayload.degree = Array.isArray(createDoctorDto.degree) ? createDoctorDto.degree : [createDoctorDto.degree];
      }

      const doctorDoc = new this.doctorModel(doctorPayload);
      savedDoctor = await doctorDoc.save();

      // send email with raw password (let errors propagate to trigger rollback)
      await this.mailService.sendAccountCreatedMail({ toEmail: email, password: rawPassword });

      dataRes.code = rc.SUCCESS;
      dataRes.message = 'Doctor created successfully';
      dataRes.data = savedDoctor;
      return dataRes;
    } catch (error) {
      // rollback created resources
      const cleanupErrors: string[] = [];
      try {
        if (savedDoctor && savedDoctor._id) {
          await this.doctorModel.deleteOne({ _id: savedDoctor._id });
        }
      } catch (e) {
        cleanupErrors.push(`doctor:${e.message}`);
      }
      try {
        if (accountDoc && accountDoc._id) {
          await this.accountModel.deleteOne({ _id: accountDoc._id });
        }
      } catch (e) {
        cleanupErrors.push(`account:${e.message}`);
      }
      try {
        if (profileDoc && profileDoc._id) {
          await this.profileModel.deleteOne({ _id: profileDoc._id });
        }
      } catch (e) {
        cleanupErrors.push(`profile:${e.message}`);
      }

      console.error('[DoctorService] Rollback cleanup errors:', cleanupErrors);

      dataRes.code = rc.ERROR;
      dataRes.message = error.message || 'Error creating doctor';
      dataRes.data = { cleanupErrors: cleanupErrors.length ? cleanupErrors : undefined };
      return dataRes;
    }
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
    status: TimeSlotStatusEnum
  ): Promise<DataResponse<TimeSlotDto[]>> {

    console.log("[DoctorService] Yêu cầu lấy timeSlots cho bác sĩ:", doctorId, "ngày:", date, "với status:", status);

    // Emit event thay cho logic trực tiếp
    const result = await emitTyped<
      { doctorId: string; date: string; status: TimeSlotStatusEnum },
      TimeSlotDto[]
    >(
      this.eventEmitter,
      "doctor.timeslot.query",
      { doctorId, date, status } // slotStatus có thể undefined
    );

    console.log("[DoctorService] Lấy timeSlots cho bác sĩ:", doctorId, "ngày:", date, "với status:", status, "→", result);

    return {
      code: rc.SUCCESS,
      message: 'Fetched time slots successfully',
      data: result ?? [],
    };
  }

  async getDoctorProfile(doctorId: string): Promise<DataResponse<ProfileDocument | null>> {
    console.log("[DoctorService] Yêu cầu lấy profile cho bác sĩ:", doctorId);
    
    const doctorProfile = await getProfileByEntity<DoctorDocument>(
      this.doctorModel,
      doctorId
    );

    if (!doctorProfile) {
      console.log("[DoctorService] Không tìm thấy profile cho bác sĩ:", doctorId);
      return {
        code: rc.ERROR,
        message: 'Doctor profile not found',
        data: null,
      };
    }
    console.log("[DoctorService] Lấy profile cho bác sĩ:", doctorId, "→", doctorProfile);

    return {
      code: rc.SUCCESS,
      message: 'Fetched doctor profile successfully',
      data: doctorProfile,
    };
  }

  async getDoctorByAccountId(accountId: string): Promise<DataResponse<any>> {
    const dataRes: DataResponse<any> = {
      code: rc.PENDING,
      message: '',
      data: null,
    };

    try {
      if (!Types.ObjectId.isValid(accountId)) {
        throw new NotFoundException('Invalid account ID');
      }

      const doctor = await this.doctorModel
        .findOne({ accountId })
        // .populate('profileId')
        // .populate('accountId')
        // .populate('chuyenKhoaId')
        .exec();

      if (!doctor) {
        dataRes.code = rc.ERROR;
        dataRes.message = 'Doctor not found for this account';
        return dataRes;
      }

      dataRes.code = rc.SUCCESS;
      dataRes.message = 'Fetched doctor successfully';
      dataRes.data = doctor;

    } catch (error) {
      dataRes.code = rc.ERROR;
      dataRes.message = error.message;
    }

    return dataRes;
  }

  async getDoctors(query: any) {
    const {
      name,
      chuyenKhoaId,
      page = 1,
      limit = 10,
    } = query;

    const filter: any = {};



    if (chuyenKhoaId) {
      filter.chuyenKhoaId = chuyenKhoaId;
    }

    const skip = (page - 1) * limit;
    // If name is provided, perform fuzzy search using Fuse.js on populated profile name and doctorName
    if (name) {
      // load candidates (apply specialty filter if present)
      const candidates: any[] = await this.doctorModel
        .find(filter)
        .populate('profileId')
        .populate('accountId')
        .populate('chuyenKhoaId')
        .lean()
        .exec();

      const fuse = new Fuse(candidates, {
        keys: [
          { name: 'doctorName', weight: 0.6 },
          { name: 'profileId.name', weight: 0.9 },
        ],
        threshold: 0.4,
        includeScore: true,
        ignoreLocation: true,
      });

      const results = fuse.search(name || '');
      const matched = results.map((r) => r.item);
      const total = matched.length;

      // pagination on matched results
      const paged = matched.slice(skip, skip + Number(limit));

      return {
        code: 200,
        message: 'Lấy danh sách bác sĩ thành công',
        data: {
          doctors: paged,
          pagination: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / limit),
          },
        },
      };
    }

    const [doctors, total] = await Promise.all([
      this.doctorModel
        .find(filter)
        .populate('profileId')
        .populate('accountId')
        .populate('chuyenKhoaId')
        .skip(skip)
        .limit(Number(limit))
        .exec(),

      this.doctorModel.countDocuments(filter),
    ]);

    return {
      code: 200,
      message: 'Lấy danh sách bác sĩ thành công',
      data: {
        doctors,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  async updateDoctor(id: string, dto: UpdateDoctorDto) {
    const doctor = await this.doctorModel
      .findById(id)
      .populate("profileId")
      .exec();

    if (!doctor) {
      return { code: 404, message: "Doctor not found", data: null };
    }

    // Cập nhật thông tin doctor
    if (dto.doctorName) doctor.doctorName = dto.doctorName;
    if (dto.specialty) doctor.chuyenKhoaId = new Types.ObjectId(dto.specialty);
    if (dto.bio) doctor.bio = dto.bio;
    if (dto.degree) doctor.degree = dto.degree;
    if (dto.academic) doctor.academic = dto.academic;
    if (dto.achievements) doctor.achievements = dto.achievements;
    if (dto.yearsOfExperience !== undefined)
      doctor.yearsOfExperience = dto.yearsOfExperience;

    await doctor.save();

    // Nếu có cập nhật profile
    if (dto.profile) {
      const profile = doctor.profileId as any;

      if (dto.profile.name) profile.name = dto.profile.name;
      if (dto.profile.email) profile.email = dto.profile.email;
      if (dto.profile.phone) profile.phone = dto.profile.phone;
      if (dto.profile.address) profile.address = dto.profile.address;
      if (dto.profile.gender) profile.gender = dto.profile.gender;
      if (dto.profile.dob) profile.dob = dto.profile.dob;
      if (dto.profile.avatarUrl) profile.avatarUrl = dto.profile.avatarUrl;

      await profile.save();
    }

    return {
      code: 200,
      message: "Doctor updated successfully",
      data: doctor,
    };
  }

  async findActiveDoctors(query: any): Promise<DataResponse<any>> {
    const { page = 1, limit = 10, chuyenKhoaId } = query;

    const skip = (page - 1) * limit;

    const matchStage: any = {
      'account.status': 'ACTIVE'
    };

    if (chuyenKhoaId) {
      matchStage['chuyenKhoaId'] = new mongoose.Types.ObjectId(chuyenKhoaId);
    }

    const doctors = await this.doctorModel.aggregate([
      // Join account
      {
        $lookup: {
          from: 'accounts',
          localField: 'accountId',
          foreignField: '_id',
          as: 'account'
        }
      },
      { $unwind: '$account' },

      // Lọc account active + filter chuyên khoa
      { $match: matchStage },

      // Join profile
      {
        $lookup: {
          from: 'profiles',
          localField: 'profileId',
          foreignField: '_id',
          as: 'profile'
        }
      },
      { $unwind: '$profile' },

      // Join chuyên khoa
      {
        $lookup: {
          from: 'chuyenkhoas',
          localField: 'chuyenKhoaId',
          foreignField: '_id',
          as: 'chuyenKhoa'
        }
      },
      { $unwind: { path: '$chuyenKhoa', preserveNullAndEmptyArrays: true } },

      // Join review doctor
      {
        $lookup: {
          from: 'reviews',
          localField: '_id',
          foreignField: 'doctorId',
          as: 'reviews'
        }
      },

      // Lấy top 5 review rating cao nhất
      {
        $addFields: {
          topReviews: {
            $slice: [
              {
                $sortArray: {
                  input: '$reviews',
                  sortBy: { rating: -1 }
                }
              },
              5
            ]
          }
        }
      },

      // Không trả full review
      { $project: { reviews: 0 } },

      // Phân trang
      { $skip: skip },
      { $limit: Number(limit) }
    ]);

    // Tổng số bác sĩ để trả pagination
    const total = await this.doctorModel.countDocuments();

    return {
      code: rc.SUCCESS,
      message: 'Lấy danh sách bác sĩ active thành công',
      data: {
        items: doctors,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total
        }
      }
    };
  }


}