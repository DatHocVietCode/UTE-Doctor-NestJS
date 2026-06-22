import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Appointment } from 'src/appointment/schemas/appointment.schema';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { AuthUser } from 'src/common/interfaces/auth-user';
import { Profile } from 'src/profile/schema/profile.schema';
import { VisitStatus } from 'src/visit/enums/visit-status.enum';
import { VisitService } from 'src/visit/visit.service';
import { CreatePatientVitalSignDto } from './dto/create-patient-vital-sign.dto';
import {
  CreatePatientVitalSignResponseDto,
  PatientHealthSummaryDto,
} from './dto/patient-health-summary.dto';
import {
  MeasuredByRole,
  OverallHealthStatus,
  VitalSignRecordState,
  VitalSignSource,
} from './enums/patient-vital-sign.enums';
import {
  ClassifiableStatus,
  classifyBloodPressure,
  classifyBmi,
  classifyHeartRate,
  computeBmi,
  computeOverallStatus,
} from './patient-vital-sign.classification';
import { mapVitalSignToDto } from './patient-vital-sign.mapper';
import { PatientVitalSign, PatientVitalSignDocument } from './schemas/patient-vital-sign.schema';

const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 50;
const FUTURE_SKEW_MS = 5 * 60 * 1000; // 5 minutes
const INTAKE_GRACE_MS = 6 * 60 * 60 * 1000; // 6 hours before scheduledAt

@Injectable()
export class PatientVitalSignService {
  private readonly logger = new Logger(PatientVitalSignService.name);

  constructor(
    @InjectModel(PatientVitalSign.name)
    private readonly vitalSignModel: Model<PatientVitalSignDocument>,
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<any>,
    @InjectModel(Profile.name)
    private readonly profileModel: Model<any>,
    private readonly visitService: VisitService,
  ) {}

  // --- Write: receptionist records a vital sign for a visit ---
  async createForVisit(
    visitId: string,
    dto: CreatePatientVitalSignDto,
    user: AuthUser,
  ): Promise<CreatePatientVitalSignResponseDto> {
    if (!visitId || !Types.ObjectId.isValid(visitId)) {
      throw new BadRequestException('Invalid visitId');
    }

    const visit = await this.visitService.getVisitById(visitId);
    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    if (
      visit.status !== VisitStatus.CHECKED_IN &&
      visit.status !== VisitStatus.IN_PROGRESS
    ) {
      throw new ConflictException(
        'Vital signs can only be recorded while the visit is CHECKED_IN or IN_PROGRESS',
      );
    }

    this.assertHasMeasurement(dto);
    this.assertBloodPressureAtomic(dto);

    const measuredAt = await this.resolveAndValidateMeasuredAt(
      dto.measuredAt,
      visit.appointmentId,
    );

    const bmi = computeBmi(dto.heightCm, dto.weightKg);
    const status = this.buildStatus(dto, bmi);
    const measuredBy = await this.resolveMeasuredBy(user);

    const created = await this.vitalSignModel.create({
      patientId: visit.patientId,
      appointmentId: visit.appointmentId,
      visitId: visit._id,
      bloodType: dto.bloodType,
      heightCm: dto.heightCm,
      weightKg: dto.weightKg,
      bmi,
      bloodPressureSystolic: dto.bloodPressureSystolic,
      bloodPressureDiastolic: dto.bloodPressureDiastolic,
      heartRateBpm: dto.heartRateBpm,
      status,
      source: VitalSignSource.RECEPTIONIST_CHECK_IN,
      recordState: VitalSignRecordState.ACTIVE,
      measuredAt,
      measuredBy,
      note: dto.note,
    });

    return { vitalSign: mapVitalSignToDto(created) };
  }

  // --- Read: patient health summary derived from ACTIVE records ---
  async getHealthSummaryForAccount(
    user: AuthUser,
    limit?: number,
  ): Promise<DataResponse<PatientHealthSummaryDto>> {
    const accountId = user?.accountId;
    const patientId = user?.patientId;
    if (!accountId) {
      throw new UnauthorizedException('Unable to identify user from token');
    }

    if (!patientId) {
      throw new NotFoundException({
        code: ResponseCode.PATIENT_NOT_FOUND,
        message: 'Patient profile not found for the account',
        data: null,
      });
    }

    const safeLimit = this.clampLimit(limit);

    const docs = await this.vitalSignModel
      .find({ patientId, recordState: VitalSignRecordState.ACTIVE })
      .sort({ measuredAt: -1, createdAt: -1 })
      .limit(safeLimit)
      .exec();

    const history = docs.map((doc) => mapVitalSignToDto(doc));
    const latest = history.length ? history[0] : null;
    const overallStatus = latest
      ? computeOverallStatus(latest.status as ClassifiableStatus)
      : OverallHealthStatus.UNEVALUATED;

    return {
      code: ResponseCode.SUCCESS,
      message: 'Fetched patient health summary successfully',
      data: {
        patientId: patientId!.toString(),
        latest,
        history,
        overallStatus,
        generatedAt: Date.now(),
      },
    };
  }

  // --- helpers ---

  private assertHasMeasurement(dto: CreatePatientVitalSignDto): void {
    const hasBloodPressure =
      this.isNum(dto.bloodPressureSystolic) && this.isNum(dto.bloodPressureDiastolic);
    const hasMeasurement =
      this.isNum(dto.heightCm) ||
      this.isNum(dto.weightKg) ||
      hasBloodPressure ||
      this.isNum(dto.heartRateBpm);

    if (!hasMeasurement) {
      throw new BadRequestException(
        'At least one measurement is required: height, weight, complete blood pressure, or heart rate. Blood type alone is not a valid vital sign.',
      );
    }
  }

  private assertBloodPressureAtomic(dto: CreatePatientVitalSignDto): void {
    const hasSystolic = this.isNum(dto.bloodPressureSystolic);
    const hasDiastolic = this.isNum(dto.bloodPressureDiastolic);

    if (hasSystolic !== hasDiastolic) {
      throw new BadRequestException(
        'Blood pressure is atomic: provide both systolic and diastolic, or neither.',
      );
    }
    if (
      hasSystolic &&
      hasDiastolic &&
      !((dto.bloodPressureSystolic as number) > (dto.bloodPressureDiastolic as number))
    ) {
      throw new BadRequestException('Systolic must be greater than diastolic.');
    }
  }

  private async resolveAndValidateMeasuredAt(
    measuredAt: number | undefined,
    appointmentId?: Types.ObjectId,
  ): Promise<number> {
    const now = Date.now();
    const value = this.isNum(measuredAt) ? (measuredAt as number) : now;

    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException('measuredAt must be a positive epoch millisecond value');
    }
    if (value > now + FUTURE_SKEW_MS) {
      throw new BadRequestException('measuredAt cannot be in the future');
    }

    if (appointmentId) {
      const appointment = (await this.appointmentModel
        .findById(appointmentId)
        .select('scheduledAt')
        .lean()
        .exec()) as { scheduledAt?: number } | null;
      const scheduledAt = appointment?.scheduledAt;
      if (this.isNum(scheduledAt)) {
        if (value < scheduledAt - INTAKE_GRACE_MS) {
          throw new BadRequestException(
            'measuredAt is earlier than the visit intake window',
          );
        }
      } else {
        this.logger.warn(
          `measuredAt lower-bound skipped: appointment ${appointmentId} has no scheduledAt`,
        );
      }
    }

    return value;
  }

  private buildStatus(
    dto: CreatePatientVitalSignDto,
    bmi: number | undefined,
  ): ClassifiableStatus | undefined {
    const status: ClassifiableStatus = {};

    const bmiStatus = classifyBmi(bmi);
    if (bmiStatus) status.bmi = bmiStatus;

    const bpStatus = classifyBloodPressure(
      dto.bloodPressureSystolic,
      dto.bloodPressureDiastolic,
    );
    if (bpStatus) status.bloodPressure = bpStatus;

    const hrStatus = classifyHeartRate(dto.heartRateBpm);
    if (hrStatus) status.heartRate = hrStatus;

    // `weight` status is intentionally never set in MVP.
    return Object.keys(status).length ? status : undefined;
  }

  private async resolveMeasuredBy(user: AuthUser): Promise<{
    id: string;
    name?: string;
    role: MeasuredByRole;
  }> {
    const id = user?.accountId ?? user?.sub ?? '';
    let name: string | undefined;

    const profileId = user?.profileId;
    if (profileId && Types.ObjectId.isValid(profileId)) {
      try {
        const profile = (await this.profileModel
          .findById(profileId)
          .select('name')
          .lean()
          .exec()) as { name?: string } | null;
        name = profile?.name ?? undefined;
      } catch (error) {
        // Best-effort snapshot; never fail the write because the name lookup failed.
        this.logger.warn(`Failed to resolve measuredBy.name for profile ${profileId}`);
      }
    }

    return { id, name, role: MeasuredByRole.RECEPTIONIST };
  }

  private clampLimit(limit?: number): number {
    const n = Number(limit);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_HISTORY_LIMIT;
    return Math.min(Math.floor(n), MAX_HISTORY_LIMIT);
  }

  private isNum(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }
}
