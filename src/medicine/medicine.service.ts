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

  // Lấy danh sách tất cả thuốc
  async findAll(): Promise<Medicine[]> {
    return this.medicineModel.find().exec();
  }

  // Lấy 1 thuốc theo id
  async findOne(id: string): Promise<Medicine> {
    const medicine = await this.medicineModel.findById(id).exec();
    if (!medicine) throw new NotFoundException(`Medicine ${id} not found`);
    return medicine;
  }

  // Cập nhật thuốc
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
