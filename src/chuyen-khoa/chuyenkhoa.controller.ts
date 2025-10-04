import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ChuyenKhoaService } from './chuyenkhoa.service';
import { ChuyenKhoa } from './schemas/chuyenkhoa.schema';

@Controller('chuyenkhoa')
export class ChuyenKhoaController {
  constructor(private readonly chuyenKhoaService: ChuyenKhoaService) {}

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
