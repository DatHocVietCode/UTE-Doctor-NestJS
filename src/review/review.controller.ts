import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { ReviewService } from './review.service';

@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

   @Get('/by-appointment-patient')
    async getReviewByAppointmentAndPatient(
      @Query('appointmentId') appointmentId: string,
      @Query('patientId') patientId: string,
    ) {
      return this.reviewService.findByAppointmentAndPatient(appointmentId, patientId);
  }

  @Post()
  async create(@Body() body) {
    return this.reviewService.create(body);
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
