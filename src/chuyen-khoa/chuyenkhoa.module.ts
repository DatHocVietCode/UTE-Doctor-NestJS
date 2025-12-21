import { Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule, InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { ChuyenKhoa, ChuyenKhoaSchema } from './schemas/chuyenkhoa.schema';
import { ChuyenKhoaService } from './chuyenkhoa.service';
import { ChuyenKhoaController } from './chuyenkhoa.controller';
import { chuyenKhoaSeed } from './chuyenkhoa.seed';
import { Doctor, DoctorSchema } from 'src/doctor/schema/doctor.schema';


@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChuyenKhoa.name, schema: ChuyenKhoaSchema },
      { name: Doctor.name, schema: DoctorSchema }, 
    ]),
  ],
  controllers: [ChuyenKhoaController],
  providers: [ChuyenKhoaService],
  exports: [ChuyenKhoaService],
})
export class ChuyenKhoaModule implements OnModuleInit {
  constructor(
    @InjectModel(ChuyenKhoa.name)
    private chuyenKhoaModel: Model<ChuyenKhoa>,

    @InjectModel(Doctor.name)
    private doctorModel: Model<Doctor>, 
  ) {}

  async onModuleInit() {
    const count = await this.chuyenKhoaModel.estimatedDocumentCount();
    if (count === 0) {
      await this.chuyenKhoaModel.insertMany(chuyenKhoaSeed);
      console.log('Đã seed dữ liệu Chuyên Khoa vào DB');
    } else {
      console.log('Chuyên Khoa đã tồn tại, bỏ qua seeding');
    }
  }
}
