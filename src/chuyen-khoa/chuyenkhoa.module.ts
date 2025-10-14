import { Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChuyenKhoa, ChuyenKhoaSchema } from './schemas/chuyenkhoa.schema';
import { ChuyenKhoaService } from './chuyenkhoa.service';
import { ChuyenKhoaController } from './chuyenkhoa.controller';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { chuyenKhoaSeed } from './chuyenkhoa.seed';


@Module({
  imports: [
    MongooseModule.forFeature([{ name: ChuyenKhoa.name, schema: ChuyenKhoaSchema }]),
  ],
  controllers: [ChuyenKhoaController],
  providers: [ChuyenKhoaService],
  exports: [ChuyenKhoaService],
})
export class ChuyenKhoaModule implements OnModuleInit {
  constructor(
    @InjectModel(ChuyenKhoa.name) private chuyenKhoaModel: Model<ChuyenKhoa>,
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
