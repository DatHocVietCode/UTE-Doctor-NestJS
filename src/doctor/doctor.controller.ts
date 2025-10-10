import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { Doctor } from './schema/doctor.schema';

@Controller('doctors')
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  // @Post()
  // async create(@Body() createDoctorDto: CreateDoctorDto): Promise<Doctor> {
  //   return this.doctorService.create(createDoctorDto);
  // }

  @Get()
  async findAll(): Promise<Doctor[]> {
    return this.doctorService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Doctor | null> {
    return this.doctorService.findById(id);
  }

  
}
