import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { PatientService } from './patient.service';
import { DataResponse } from 'src/common/dto/data-respone';
import { Types } from 'mongoose';

@Controller('patients')
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  @Get('/admin/')
  async getAllPatients(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('keyword') keyword?: string
  ) {
    return this.patientService.findAll(
      Number(page) || 1,
      Number(limit) || 10,
      keyword || ''
    );
  }


  @Get('/me')
  async getPatientProfile(@Query('email') email: string) : Promise<DataResponse> {
    return await this.patientService.getPatientProfileByEmail(email);
  }

  @Get("by-account/:accountId")
  async getPatientByAccount(@Param("accountId") accountId: string) {
    const patient = await this.patientService.findByAccountId(accountId);

    if (!patient) {
      return {
        code: "NOT_FOUND",
        message: "Patient not found for this accountId",
      };
    }

    return {
      code: "SUCCESS",
      message: "Patient fetched successfully",
      data: patient,
    };
  }
  @Get('/profile/:id')
  async getPatientById(@Param('id') id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid patient ID');
    }

    const patient = await this.patientService.findProfileById(id);

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    return patient;
  }

}
