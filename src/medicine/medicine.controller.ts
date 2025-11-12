import { Controller, Get, Post, Put, Delete, Param, Body } from "@nestjs/common";
import { MedicineService } from "./medicine.service";
import { CreateMedicineDto } from "./dto/create-medicine.dto";
import { UpdateMedicineDto } from "./dto/update-medicine.dto";

@Controller("medicines")
export class MedicineController {
  constructor(private readonly medicineService: MedicineService) {}

  @Post()
  create(@Body() createMedicineDto: CreateMedicineDto) {
    return this.medicineService.create(createMedicineDto);
  }

  @Get()
  findAll() {
    return this.medicineService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.medicineService.findOne(id);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() updateMedicineDto: UpdateMedicineDto) {
    return this.medicineService.update(id, updateMedicineDto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.medicineService.remove(id);
  }
}
