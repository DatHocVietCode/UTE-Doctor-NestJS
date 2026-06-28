import { Body, Controller, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { RoleEnum } from 'src/common/enum/role.enum';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/guards/roles.decorator';
import { DoctorService } from 'src/doctor/doctor.service';
import { ListReceptionistQueryDto } from 'src/receptionist/dto/list-receptionist.query.dto';
import { ReceptionistService } from 'src/receptionist/receptionist.service';

// Admin-only staff provisioning. Each endpoint creates the full Account -> Profile -> Doctor /
// Receptionist chain in a single Mongo transaction so the created user can log in immediately.
// Routes (with global /api prefix): POST /api/admin/doctors, POST /api/admin/receptionists.
@Controller('admin')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(RoleEnum.ADMIN)
export class AdminUserController {
  constructor(
    private readonly doctorService: DoctorService,
    private readonly receptionistService: ReceptionistService,
  ) {}

  @Post('doctors')
  @UseInterceptors(FileInterceptor('avatar', { storage: multer.memoryStorage() }))
  async createDoctor(@Body() body: any, @UploadedFile() avatar?: Express.Multer.File) {
    this.normalizeMultipart(body);
    return this.doctorService.createWithAccount(body, avatar);
  }

  @Post('receptionists')
  @UseInterceptors(FileInterceptor('avatar', { storage: multer.memoryStorage() }))
  async createReceptionist(@Body() body: any, @UploadedFile() avatar?: Express.Multer.File) {
    this.normalizeMultipart(body);
    return this.receptionistService.createWithAccount(body, avatar);
  }

  // GET /api/admin/receptionists — paginated list for the Admin Receptionists page.
  // Joined Account -> Profile -> Receptionist, mapped to a clean DTO (no password/hash).
  @Get('receptionists')
  async listReceptionists(@Query() query: ListReceptionistQueryDto) {
    return this.receptionistService.listReceptionists(query);
  }

  // multipart/form-data sends nested/array fields as strings — normalize them so the service
  // receives the same shape as a JSON request (mirrors DoctorController.createDoctor).
  private normalizeMultipart(body: any) {
    if (typeof body.profile === 'string') body.profile = JSON.parse(body.profile);
    if (typeof body.degree === 'string') body.degree = JSON.parse(body.degree);
    if (typeof body.yearsOfExperience === 'string') body.yearsOfExperience = Number(body.yearsOfExperience);
  }
}
