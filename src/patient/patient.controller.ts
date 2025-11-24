import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PatientService } from './patient.service';
import { DataResponse } from 'src/common/dto/data-respone';

@Controller('patients')
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

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

}
