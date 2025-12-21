import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Types } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { PatientService } from './patient.service';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';

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

  @Post('/:id/medical-profile')
  async upsertMedicalProfile(@Param('id') id: string, @Body() body: any) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid patient ID');
    }
    const profile = await this.patientService.upsertMedicalProfile(id, body);
    return {
      code: ResponseCode.SUCCESS,
      message: "Medical profile updated",
      data: profile,
    } satisfies DataResponse;
  }

  @Post('/:id/allergies')
  async addAllergy(@Param('id') id: string, @Body() body: any) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid patient ID');
    }
    const allergy = await this.patientService.addAllergyRecord(id, body);
    return {
      code: ResponseCode.SUCCESS,
      message: "Allergy record created",
      data: allergy,
    } satisfies DataResponse;
  }

  @Post('/:id/medical-history')
  async addMedicalHistory(@Param('id') id: string, @Body() body: any) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid patient ID');
    }
    const history = await this.patientService.addMedicalHistoryRecord(id, body);
    return {
      code: ResponseCode.SUCCESS,
      message: "Medical history record created",
      data: history,
    } satisfies DataResponse;
  }

}
