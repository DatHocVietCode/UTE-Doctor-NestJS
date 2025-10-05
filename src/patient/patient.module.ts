import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PatientController } from './patient.controller';
import { PatientService } from './patient.service';
import { Patient, PatientSchema } from './schema/patient.schema';
import { AccountModule } from 'src/account/account.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: Patient.name, schema: PatientSchema }]),
  forwardRef(() => AccountModule)],
  providers: [PatientService],
  controllers: [PatientController],
  exports: [PatientService],
})
export class PatientModule {}
