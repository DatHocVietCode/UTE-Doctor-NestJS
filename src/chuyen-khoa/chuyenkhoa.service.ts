import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChuyenKhoa, ChuyenKhoaDocument } from './schemas/chuyenkhoa.schema';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';

@Injectable()
export class ChuyenKhoaService {
  constructor(
    @InjectModel(ChuyenKhoa.name) 
    private readonly chuyenKhoaModel: Model<ChuyenKhoaDocument>,
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

  async remove(id: string): Promise<ChuyenKhoa | null> {
    return this.chuyenKhoaModel.findByIdAndDelete(id).exec();
  }
}
