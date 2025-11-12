import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { MedicineService } from "./medicine.service";
import { MedicineController } from "./medicine.controller";
import { Medicine, MedicineSchema } from "./schema/medicine.schema";
import { MedicineSeeder } from "src/medicine/medicine.seed";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Medicine.name, schema: MedicineSchema }])
  ],
  controllers: [MedicineController],
  providers: [MedicineService, MedicineSeeder],
  exports: [MedicineService]
})
export class MedicineModule {}
