import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { ReviewService } from './review.service';

@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Post()
  async create(@Body() body) {
    return this.reviewService.create(body);
  }

  @Get()
  async findAll() {
    return this.reviewService.findAll();
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
