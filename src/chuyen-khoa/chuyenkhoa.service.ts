import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChuyenKhoa, ChuyenKhoaDocument } from './schemas/chuyenkhoa.schema';

@Injectable()
export class ChuyenKhoaService {
  constructor(
    @InjectModel(ChuyenKhoa.name) 
    private readonly chuyenKhoaModel: Model<ChuyenKhoaDocument>,
  ) {}

  async findAll(): Promise<ChuyenKhoa[]> {
    const all = await this.chuyenKhoaModel.find().lean().exec();
    console.log('All specialties:', all);
    return all;
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
