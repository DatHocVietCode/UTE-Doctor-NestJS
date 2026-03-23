import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { JwtAuthGuard } from 'src/common/guards/jws-auth.guard';
import { AuthUser } from 'src/common/interfaces/auth-user';
import { PatientService } from './patient.service';

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


  @UseGuards(JwtAuthGuard)
  @Get('/me')
  async getPatientProfile(@Req() req: any): Promise<DataResponse> {
    const user = req.user as AuthUser | undefined;
    if (!user?.email) {
      throw new UnauthorizedException('Unable to identify user from token');
    }
    return await this.patientService.getPatientProfileByUser(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get("by-account")
  async getPatientByAccount(@Req() req: any) {
    const user = req.user as AuthUser | undefined;
    const accountId = user?.accountId;
    if (!accountId) {
      throw new UnauthorizedException('Unable to identify user from token');
    }
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

  @UseGuards(JwtAuthGuard)
  @Post('/me/medical-profile')
  async upsertMedicalProfile(@Req() req: any, @Body() body: any) {
    const user = req.user as AuthUser | undefined;
    const patientId = user?.patientId;
    if (!patientId || !Types.ObjectId.isValid(patientId)) {
      throw new NotFoundException('Invalid patient ID');
    }
    const profile = await this.patientService.upsertMedicalProfile(patientId, body, user);
    return {
      code: ResponseCode.SUCCESS,
      message: "Medical profile updated",
      data: profile,
    } satisfies DataResponse;
  }

  @UseGuards(JwtAuthGuard)
  @Post('/me/allergies')
  async addAllergy(@Req() req: any, @Body() body: any) {
    const user = req.user as AuthUser | undefined;
    const patientId = user?.patientId;
    if (!patientId || !Types.ObjectId.isValid(patientId)) {
      throw new NotFoundException('Invalid patient ID');
    }
    const allergy = await this.patientService.addAllergyRecord(patientId, body, user);
    return {
      code: ResponseCode.SUCCESS,
      message: "Allergy record created",
      data: allergy,
    } satisfies DataResponse;
  }

  @UseGuards(JwtAuthGuard)
  @Post('/me/medical-history')
  async addMedicalHistory(@Req() req: any, @Body() body: any) {
    const user = req.user as AuthUser | undefined;
    const patientId = user?.patientId;
    if (!patientId || !Types.ObjectId.isValid(patientId)) {
      throw new NotFoundException('Invalid patient ID');
    }
    const history = await this.patientService.addMedicalHistoryRecord(patientId, body, user);
    return {
      code: ResponseCode.SUCCESS,
      message: "Medical history record created",
      data: history,
    } satisfies DataResponse;
  }

}
