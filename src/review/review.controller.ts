import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ReviewService } from './review.service';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { AuthUser } from 'src/common/interfaces/auth-user';

@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

   @Get('/by-appointment-patient')
    @UseGuards(JwtAuthGuard)
    async getReviewByAppointmentAndPatient(
      @Req() req: any,
      @Query('appointmentId') appointmentId: string,
    ) {
      const user = req.user as AuthUser;
      if (!user?.patientId) {
        throw new UnauthorizedException('Unable to identify patient from token');
      }
      return this.reviewService.findByAppointmentAndPatient(appointmentId, user);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Req() req: any, @Body() body) {
    const user = req.user as AuthUser;
    if (!user?.patientId) {
      throw new UnauthorizedException('Unable to identify patient from token');
    }
    return this.reviewService.create(body, user);
  }

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reviewService.findAll(
      Number(page) || 1,
      Number(limit) || 10,
    );
  }


  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.reviewService.findById(id);
  }

  @Get('doctor/:doctorId')
  async findByDoctor(@Param('doctorId') doctorId: string) {
    return this.reviewService.findByDoctorId(doctorId);
  }
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto) {
    return this.reviewService.update(id, dto);
  }
  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.reviewService.delete(id);
  }


}
