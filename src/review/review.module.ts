import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReviewService } from './review.service';
import { ReviewController } from './review.controller';
import { Review, ReviewSchema } from 'src/review/schema/review.schema';
import { Doctor, DoctorSchema } from 'src/doctor/schema/doctor.schema';
import { Patient, PatientSchema } from 'src/patient/schema/patient.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Review.name, schema: ReviewSchema },
      { name: Doctor.name, schema: DoctorSchema },
      { name: Patient.name, schema: PatientSchema }
    ])
  ],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}
