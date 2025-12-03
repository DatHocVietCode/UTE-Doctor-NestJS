import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { Doctor } from './schema/doctor.schema';
import { DataResponse } from 'src/common/dto/data-respone';
import { TimeSlotStatusEnum } from 'src/timeslot/enums/timeslot-status.enum';
import { GetDoctorDto } from 'src/doctor/dto/get-doctor.dto';

@Controller('doctors')
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @Post()
  async createDoctor(@Body() dto: CreateDoctorDto) {
    const res = await this.doctorService.createWithAccount(dto);
    return res;
  }

    @Get('/admin')
    async getDoctors(@Query() query: GetDoctorDto) {
      return this.doctorService.getDoctors(query);
    }


  // @Post()
  // async create(@Body() createDoctorDto: CreateDoctorDto): Promise<Doctor> {
  //   return this.doctorService.create(createDoctorDto);
  // }

  @Get()
  async findAll(): Promise<Doctor[]> {
    return this.doctorService.findAll();
  }

  @Get('/specialty')
  async getDoctorBySpecialty(
    @Query('specialtyId') specialtyId?: string,  // dùng Query thay vì Param
    @Query('keyword') keyword?: string           // nếu sau này muốn thêm tìm kiếm
  ): Promise<DataResponse<any>> {
    console.log('Received request to get doctors by specialty:', specialtyId, 'with keyword:', keyword);
    return this.doctorService.searchDoctors({ specialtyId, keyword });
  }

  
  @Get('doctor/:doctorId/date/:date')
  async getTimeSlotsByDoctorAndDate(
    @Param('doctorId') doctorId: string,
    @Param('date') date: string,
    @Query('status') status?: string // optional từ client
  ) {
  const slotStatus: TimeSlotStatusEnum =
      !status || status.toLowerCase() === 'all'
        ? TimeSlotStatusEnum.ALL
        : (status as TimeSlotStatusEnum);

    return this.doctorService.getTimeSlotsByDoctorAndDate(doctorId, date, slotStatus);
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Doctor | null> {
    return this.doctorService.findById(id);
  }
  @Get('/account/:accountId')
  async getDoctorByAccountId(@Param('accountId') accountId: string) {
    return this.doctorService.getDoctorByAccountId(accountId);
  }


}
