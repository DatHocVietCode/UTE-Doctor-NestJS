import { Body, Controller, Get, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors, UnauthorizedException } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { Doctor } from './schema/doctor.schema';
import { DataResponse } from 'src/common/dto/data-respone';
import { TimeSlotStatusEnum } from 'src/timeslot/enums/timeslot-status.enum';
import { GetDoctorDto } from 'src/doctor/dto/get-doctor.dto';
import { Types } from 'mongoose';
import { UpdateDoctorDto } from 'src/doctor/dto/update-doctor.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { AuthUser } from 'src/common/interfaces/auth-user';

@Controller('doctors')
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

    @Get('/active')
    async getActiveDoctors(@Query() query) {
      return this.doctorService.findActiveDoctors(query);
    }

  @Post()
  @UseInterceptors(FileInterceptor('avatar', { storage: multer.memoryStorage() }))
  async createDoctor(
    @Body() body: any,
    @UploadedFile() avatar?: Express.Multer.File,
  ) {
    if (typeof body.profile === 'string') {
      body.profile = JSON.parse(body.profile);
    }
    if (typeof body.degree === 'string') {
      body.degree = JSON.parse(body.degree);
    }
    if (typeof body.yearsOfExperience === 'string') {
      body.yearsOfExperience = Number(body.yearsOfExperience);
    }

    const res = await this.doctorService.createWithAccount(body, avatar);
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

  @Get('/me')
  @UseGuards(JwtAuthGuard)
  async getDoctorByAccountId(@Req() req: any) {
    const user = req.user as AuthUser;
    if (!user?.accountId) {
      throw new UnauthorizedException('Unable to identify user from token');
    }
    return this.doctorService.getDoctorByAccountId(user.accountId);
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Doctor | null> {
    return this.doctorService.findById(id);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('avatar', { storage: multer.memoryStorage() }))
  updateDoctor(
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFile() avatar?: Express.Multer.File,
  ) {
    if (typeof body.profile === 'string') {
      body.profile = JSON.parse(body.profile);
    }
    if (typeof body.degree === 'string') {
      body.degree = JSON.parse(body.degree);
    }
    if (typeof body.yearsOfExperience === 'string') {
      body.yearsOfExperience = Number(body.yearsOfExperience);
    }

    return this.doctorService.updateDoctor(id, body, avatar);
  }

}
