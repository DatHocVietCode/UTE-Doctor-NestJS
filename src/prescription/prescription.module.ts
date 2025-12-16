// prescription.module.ts
import { Module } from '@nestjs/common';
import { PrescriptionController } from './prescription.controller';
import { PrescriptionPdfService } from 'src/prescription/prescription-pdf.service';

@Module({
  controllers: [PrescriptionController],
  providers: [PrescriptionPdfService],
  exports: [PrescriptionPdfService],
})
export class PrescriptionModule {}