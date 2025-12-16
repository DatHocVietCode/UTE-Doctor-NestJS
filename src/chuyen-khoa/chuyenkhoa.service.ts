import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChuyenKhoa, ChuyenKhoaDocument } from './schemas/chuyenkhoa.schema';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { Doctor, DoctorDocument } from 'src/doctor/schema/doctor.schema';

@Injectable()
export class ChuyenKhoaService {
  constructor(
    @InjectModel(ChuyenKhoa.name) 
    private readonly chuyenKhoaModel: Model<ChuyenKhoaDocument>,
    @InjectModel(Doctor.name) 
    private readonly doctorModel: Model<DoctorDocument>,
    
  ) {}

  async findAll(): Promise<DataResponse<{_id: string, name: string}>> {
    const all = await this.chuyenKhoaModel
      .find({}, { name: 1 }) // chỉ lấy field name và id (_id mặc định luôn có)
      .lean()
      .exec();

    console.log('All specialties (simplified):', all);
    const dataRes : DataResponse<any> = {
      code: ResponseCode.SUCCESS,
      message: 'Fetched all specialties successfully',
      data: all
    }
    return dataRes;
  }

  async findAllAdmin(
    page: number = 1,
    limit: number = 10,
    key?: string,
  ): Promise<DataResponse<{
    items: { _id: string; name: string }[];
    total: number;
    page: number;
    limit: number;
  }>> {
    const skip = (page - 1) * limit;

    const filter: any = {};

    if (key) {
      filter.name = {
        $regex: key,
        $options: 'i', // không phân biệt hoa thường
      };
    }

    const [items, total] = await Promise.all([
      this.chuyenKhoaModel
        .find(filter, { name: 1 })
        .sort({ name: 1 })        // 🔤 A → Z
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),

      this.chuyenKhoaModel.countDocuments(filter),
    ]);

    const dataRes: DataResponse<any> = {
      code: ResponseCode.SUCCESS,
      message: 'Fetched specialties with pagination & search successfully',
      data: {
        items,
        total,
        page,
        limit,
      },
    };

    return dataRes;
  }




  async findOne(id: string): Promise<ChuyenKhoa | null> {
    return this.chuyenKhoaModel.findById(id).exec();
  }

  async create(data: Partial<ChuyenKhoa>): Promise<ChuyenKhoa> {
    const newCK = new this.chuyenKhoaModel(data);
    return newCK.save();
  }

  async update(id: string, data: Partial<ChuyenKhoa>): Promise<ChuyenKhoa | null> {
    return this.chuyenKhoaModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async remove(id: string): Promise<any> {
    if (!Types.ObjectId.isValid(id)) {
      return {
        success: false,
        message: 'Invalid chuyen khoa id',
      };
    }

    const chuyenKhoa = await this.chuyenKhoaModel.findById(id);
    if (!chuyenKhoa) {
      return {
        success: false,
        message: 'Chuyên khoa không tồn tại',
      };
    }

    const doctorCount = await this.doctorModel.countDocuments({
      chuyenKhoaId: id,
    });

    if (doctorCount > 0) {
      return {
        success: false,
        message: 'Không thể xoá chuyên khoa vì đang có bác sĩ thuộc chuyên khoa này',
      };
    }

    await this.chuyenKhoaModel.findByIdAndDelete(id);

    return {
      success: true,
      message: 'Xoá chuyên khoa thành công',
    };
  }


}
