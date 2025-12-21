import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  Query,
  Patch,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateDoctorPostDto } from './dto/create-doctor-post.dto';
import { UpdateDoctorPostDto } from './dto/update-doctor-post.dto';
import { DoctorPostService } from './post.service';
import { UpdateDoctorPostStatusDto } from 'src/post/dto/update-post-status.dto';

@Controller('doctor-posts')
export class DoctorPostController {
  constructor(private readonly doctorPostService: DoctorPostService) {}


  @Post()
  @UseInterceptors(FileInterceptor('file'))
  create(
    @Body() dto: CreateDoctorPostDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.doctorPostService.create(dto, file);
  }

  @Get()
    findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    ) {
    return this.doctorPostService.findAll(
        Number(page) || 1,
        Number(limit) || 10,
    );
    }


  @Get('doctor/:doctorId')
  findByDoctor(
    @Param('doctorId') doctorId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.doctorPostService.findByDoctor(
      doctorId,
      Number(page) || 1,
      Number(limit) || 10,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.doctorPostService.findOne(id);
  }

  @Put(':id')
  @UseInterceptors(FileInterceptor('file'))
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDoctorPostDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.doctorPostService.update(id, dto, file);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.doctorPostService.remove(id);
  }

  @Post(':id/view')
  increaseView(@Param('id') id: string) {
    return this.doctorPostService.increaseView(id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDoctorPostStatusDto,
  ) {
    return this.doctorPostService.updateStatus(id, dto.status);
  }
}
