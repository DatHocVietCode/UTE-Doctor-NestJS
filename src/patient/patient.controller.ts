import { Body, Controller, Post } from '@nestjs/common';
import { CreatePatientDto } from './dto/create-patient.dto';
import { PatientService } from './patient.service';
import { Patient } from './schema/patient.schema';

@Controller('patients')
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  @Post()
  async create(@Body() createPatientDto: CreatePatientDto): Promise<Patient> {
    return this.patientService.create(createPatientDto);
  }
}
