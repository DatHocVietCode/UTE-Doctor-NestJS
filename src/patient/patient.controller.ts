import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PatientService } from './patient.service';
import { DataResponse } from 'src/common/dto/data-respone';

@Controller('patients')
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  @Get('/me')
  async getPatientProfile(@Query('email') email: string) : Promise<DataResponse> {
    return await this.patientService.getPatientByEmail(email);
  }
}
