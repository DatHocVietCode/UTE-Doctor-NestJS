import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreatePatientDto } from './dto/create-patient.dto';
import { PatientService } from './patient.service';

@Controller('patients')
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  // @Get()
  // async gePatientProfile() : Promise<PatientProfileDTO> {
  //   return null;
  // }
}
