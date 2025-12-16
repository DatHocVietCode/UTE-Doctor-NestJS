import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ChuyenKhoaService } from './chuyenkhoa.service';
import { ChuyenKhoa } from './schemas/chuyenkhoa.schema';

@Controller('chuyenkhoa')
export class ChuyenKhoaController {
  constructor(private readonly chuyenKhoaService: ChuyenKhoaService) {}

  @Get('admin')
  findAllAdmin(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('key') key?: string,
  ) {
    return this.chuyenKhoaService.findAllAdmin(
      Number(page) || 1,
      Number(limit) || 10,
      key,
    );
  }


  @Get()
  findAll() {
    return this.chuyenKhoaService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.chuyenKhoaService.findOne(id);
  }

  @Post()
  create(@Body() data: Partial<ChuyenKhoa>) {
    return this.chuyenKhoaService.create(data);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: Partial<ChuyenKhoa>) {
    return this.chuyenKhoaService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.chuyenKhoaService.remove(id);
  }
}
