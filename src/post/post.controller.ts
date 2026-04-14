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
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateDoctorPostDto, CreateDoctorPostRequestDto } from './dto/create-doctor-post.dto';
import { UpdateDoctorPostDto } from './dto/update-doctor-post.dto';
import { DoctorPostService } from './post.service';
import { UpdateDoctorPostStatusDto } from 'src/post/dto/update-post-status.dto';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { AuthUser } from 'src/common/interfaces/auth-user';

@Controller('doctor-posts')
export class DoctorPostController {
  constructor(private readonly doctorPostService: DoctorPostService) {}


  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  create(
    @Req() req: any,
    @Body() dto: CreateDoctorPostRequestDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const user = req.user as AuthUser;
    if (!user?.doctorId) {
      throw new UnauthorizedException('Unable to identify doctor from token');
    }
    const payload: CreateDoctorPostDto = {
      ...dto,
      doctorId: user.doctorId,
    };
    return this.doctorPostService.create(payload, file);
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
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDoctorPostDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.doctorPostService.update(id, dto, file);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) {
    return this.doctorPostService.remove(id);
  }

  @Post(':id/view')
  increaseView(@Param('id') id: string) {
    return this.doctorPostService.increaseView(id);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDoctorPostStatusDto,
  ) {
    return this.doctorPostService.updateStatus(id, dto.status);
  }
}
