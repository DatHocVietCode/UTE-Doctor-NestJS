import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Medicine, MedicineDocument } from "./schema/medicine.schema";
import { CreateMedicineDto } from "./dto/create-medicine.dto";
import { UpdateMedicineDto } from "./dto/update-medicine.dto";

@Injectable()
export class MedicineService {
  constructor(
    @InjectModel(Medicine.name)
    private readonly medicineModel: Model<MedicineDocument>
  ) {}

  // Tạo thuốc mới
  async create(createMedicineDto: CreateMedicineDto): Promise<Medicine> {
    const medicine = new this.medicineModel(createMedicineDto);
    return medicine.save();
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    keyword?: string,
    sort: 'asc' | 'desc' = 'asc',
  ) {
    const skip = (page - 1) * limit;

    const filter: any = {};

    if (keyword) {
      filter.name = { $regex: keyword, $options: 'i' };
    }

    const sortOrder = sort === 'asc' ? 1 : -1;

    const [data, total] = await Promise.all([
      this.medicineModel
        .find(filter)
        .collation({ locale: 'en', strength: 1 })
        .sort({ name: sortOrder })
        .skip(skip)
        .limit(limit)
        .exec(),

      this.medicineModel.countDocuments(filter),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }


  async findOne(id: string): Promise<Medicine> {
    const medicine = await this.medicineModel.findById(id).exec();
    if (!medicine) throw new NotFoundException(`Medicine ${id} not found`);
    return medicine;
  }

  async update(id: string, updateMedicineDto: UpdateMedicineDto): Promise<Medicine> {
    const medicine = await this.medicineModel.findByIdAndUpdate(
      id,
      updateMedicineDto,
      { new: true }
    ).exec();
    if (!medicine) throw new NotFoundException(`Medicine ${id} not found`);
    return medicine;
  }

  // Xóa thuốc
  async remove(id: string): Promise<{ deleted: boolean }> {
    const result = await this.medicineModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException(`Medicine ${id} not found`);
    return { deleted: true };
  }
}
