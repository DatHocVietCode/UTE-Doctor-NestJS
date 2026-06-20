import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppointmentStatus } from 'src/appointment/enums/Appointment-status.enum';
import {
  Appointment,
  AppointmentDocument,
} from 'src/appointment/schemas/appointment.schema';
import { Doctor } from 'src/doctor/schema/doctor.schema';
import { MedicalEncounterService } from 'src/patient/medical-encounter.service';
import { Patient } from 'src/patient/schema/patient.schema';
import { Profile } from 'src/profile/schema/profile.schema';
import { TimeSlotLog, TimeSlotLogDocument } from 'src/timeslot/schemas/timeslot-log.schema';
import { CompleteVisitDto } from './dto/complete-visit.dto';
import { VisitStatus } from './enums/visit-status.enum';
import { Visit, VisitDocument } from './schemas/visit.schema';
import { TimeHelper } from 'src/utils/helpers/time.helper';

type ReceptionistVisitItem = {
  visitId: string;
  appointmentId: string;
  status: VisitStatus;
  scheduledAt: number;
  patientName: string;
  doctorName: string;
  appointmentStatus?: AppointmentStatus | string;
};

@Injectable()
export class VisitService {
  private readonly logger = new Logger(VisitService.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    @InjectModel(Visit.name)
    private readonly visitModel: Model<VisitDocument>,
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(TimeSlotLog.name)
    private readonly timeSlotLogModel: Model<TimeSlotLogDocument>,
    @InjectModel(Patient.name)
    private readonly patientModel: Model<any>,
    @InjectModel(Doctor.name)
    private readonly doctorModel: Model<any>,
    @InjectModel(Profile.name)
    private readonly profileModel: Model<any>,
    private readonly medicalEncounterService: MedicalEncounterService,
  ) {}

  async getTodayVisitsForReceptionist(
    timezone?: string,
  ): Promise<ReceptionistVisitItem[]> {
    const range = TimeHelper.getIanaTimezoneDayRange(new Date(), timezone);
    this.logTodayVisitRange('receptionist', range);

    const visits = await this.visitModel
      .aggregate([
        {
          $lookup: {
            from: this.appointmentModel.collection.name,
            localField: 'appointmentId',
            foreignField: '_id',
            as: 'appointment',
          },
        },
        { $unwind: '$appointment' },
        {
          $match: {
            'appointment.scheduledAt': {
              $gte: range.startEpoch,
              $lt: range.endEpoch,
            },
          },
        },
        {
          $lookup: {
            from: this.patientModel.collection.name,
            localField: 'patientId',
            foreignField: '_id',
            as: 'patient',
          },
        },
        { $unwind: { path: '$patient', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: this.profileModel.collection.name,
            localField: 'patient.profileId',
            foreignField: '_id',
            as: 'patientProfile',
          },
        },
        { $unwind: { path: '$patientProfile', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: this.doctorModel.collection.name,
            localField: 'doctorId',
            foreignField: '_id',
            as: 'doctor',
          },
        },
        { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: this.profileModel.collection.name,
            localField: 'doctor.profileId',
            foreignField: '_id',
            as: 'doctorProfile',
          },
        },
        { $unwind: { path: '$doctorProfile', preserveNullAndEmptyArrays: true } },
        {
          $sort: {
            'appointment.scheduledAt': 1,
          },
        },
        {
          $project: {
            _id: 0,
            visitId: '$_id',
            appointmentId: { $toString: '$appointment._id' },
            status: 1,
            scheduledAt: '$appointment.scheduledAt',
            patientName: { $ifNull: ['$patientProfile.name', ''] },
            doctorName: { $ifNull: ['$doctorProfile.name', ''] },
            appointmentStatus: '$appointment.appointmentStatus',
          },
        },
      ])
      .exec();

    return visits as ReceptionistVisitItem[];
  }

  async getTodayVisitsForDoctor(
    doctorId: string,
    timezone?: string,
  ): Promise<ReceptionistVisitItem[]> {
    const range = TimeHelper.getIanaTimezoneDayRange(new Date(), timezone);
    this.logTodayVisitRange(`doctor:${doctorId}`, range);

    const visits = await this.visitModel
      .aggregate([
        {
          $match: {
            doctorId: new Types.ObjectId(doctorId),
            status: { $in: ['CHECKED_IN', 'IN_PROGRESS'] },
          },
        },
        {
          $lookup: {
            from: this.appointmentModel.collection.name,
            localField: 'appointmentId',
            foreignField: '_id',
            as: 'appointment',
          },
        },
        { $unwind: '$appointment' },
        {
          $match: {
            'appointment.scheduledAt': {
              $gte: range.startEpoch,
              $lt: range.endEpoch,
            },
          },
        },
        {
          $lookup: {
            from: this.patientModel.collection.name,
            localField: 'patientId',
            foreignField: '_id',
            as: 'patient',
          },
        },
        { $unwind: { path: '$patient', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: this.profileModel.collection.name,
            localField: 'patient.profileId',
            foreignField: '_id',
            as: 'patientProfile',
          },
        },
        { $unwind: { path: '$patientProfile', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: this.doctorModel.collection.name,
            localField: 'doctorId',
            foreignField: '_id',
            as: 'doctor',
          },
        },
        { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: this.profileModel.collection.name,
            localField: 'doctor.profileId',
            foreignField: '_id',
            as: 'doctorProfile',
          },
        },
        { $unwind: { path: '$doctorProfile', preserveNullAndEmptyArrays: true } },
        {
          $sort: {
            'appointment.scheduledAt': 1,
          },
        },
        {
          $project: {
            _id: 0,
            visitId: '$_id',
            appointmentId: { $toString: '$appointment._id' },
            status: 1,
            scheduledAt: '$appointment.scheduledAt',
            patientName: { $ifNull: ['$patientProfile.name', ''] },
            doctorName: { $ifNull: ['$doctorProfile.name', ''] },
            appointmentStatus: '$appointment.appointmentStatus',
          },
        },
      ])
      .exec();

    return visits as ReceptionistVisitItem[];
  }

  private logTodayVisitRange(
    audience: string,
    range: {
      timezone: string;
      dateKey: string;
      startEpoch: number;
      endEpoch: number;
    },
  ) {
    // Log the effective local day and UTC query bounds so midnight issues are diagnosable.
    this.logger.log(
      `Fetching today visits audience=${audience} timezone=${range.timezone} ` +
        `localDate=${range.dateKey} utcRange=[${new Date(range.startEpoch).toISOString()}, ` +
        `${new Date(range.endEpoch).toISOString()})`,
    );
  }

  async getVisitById(visitId: string) {
    if (!Types.ObjectId.isValid(visitId)) {
      return null;
    }
    return this.visitModel.findById(visitId).exec();
  }

  async createVisitFromAppointment(appointment: {
    appointmentId?: string;
    _id?: Types.ObjectId | string;
    doctorId?: Types.ObjectId | string;
    patientId?: Types.ObjectId | string;
  }): Promise<VisitDocument> {
    const appointmentId =
      appointment.appointmentId ??
      (appointment._id ? appointment._id.toString() : undefined);

    if (!appointmentId || !Types.ObjectId.isValid(appointmentId)) {
      throw new BadRequestException('Invalid appointmentId for visit creation');
    }

    // Idempotency guard: return existing visit if this appointment already produced one.
    const existingVisit = await this.visitModel.findOne({ appointmentId }).exec();
    if (existingVisit) {
      return existingVisit;
    }

    const sourceAppointment = await this.appointmentModel
      .findById(appointmentId)
      .lean()
      .exec();
    if (!sourceAppointment) {
      throw new NotFoundException('Appointment not found');
    }

    if (!sourceAppointment.doctorId || !sourceAppointment.patientId) {
      throw new BadRequestException(
        'Appointment is missing doctorId or patientId for visit creation',
      );
    }

    try {
      return await this.visitModel.create({
        appointmentId: sourceAppointment._id,
        doctorId: sourceAppointment.doctorId,
        patientId: sourceAppointment.patientId,
        status: VisitStatus.CREATED,
      });
    } catch (error: any) {
      // Handle race condition from parallel event deliveries by reading the existing record.
      if (error?.code === 11000) {
        const duplicatedVisit = await this.visitModel
          .findOne({ appointmentId })
          .exec();
        if (duplicatedVisit) {
          return duplicatedVisit;
        }
      }
      throw error;
    }
  }

  async updateVisitStatus(visitId: string, status: VisitStatus): Promise<VisitDocument> {

    if (!Types.ObjectId.isValid(visitId)) {
        console.warn(`Invalid visitId format: ${visitId}`);
      throw new BadRequestException('Invalid visitId');
    }

    const visit = await this.visitModel.findById(visitId).exec();
    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    const appointment = await this.appointmentModel
      .findById(visit.appointmentId)
      .select('appointmentStatus')
      .lean()
      .exec();

    if (!appointment) {
      throw new NotFoundException('Appointment not found for visit');
    }

    if (status === visit.status) {
      return visit;
    }

    this.assertStatusTransitionValid(visit.status, status, appointment.appointmentStatus);

    visit.status = status;

    if (status === VisitStatus.IN_PROGRESS) {
      visit.startedAt = Date.now();
    }

    if (status === VisitStatus.COMPLETED) {
      visit.completedAt = Date.now();
    }

    await visit.save();
    return visit;
  }

  async checkInVisit(visitId: string): Promise<VisitDocument> {
    const visit = await this.visitModel.findById(visitId).exec();
    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    if (visit.status !== VisitStatus.CREATED) {
      throw new ConflictException('Visit can only be checked in from CREATED');
    }

    const appointment = await this.appointmentModel
      .findById(visit.appointmentId)
      .select('appointmentStatus')
      .lean()
      .exec();

    if (!appointment) {
      throw new NotFoundException('Appointment not found for visit');
    }

    if (appointment.appointmentStatus !== AppointmentStatus.CONFIRMED) {
      throw new BadRequestException('Cannot check in visit when appointment is not CONFIRMED');
    }

    visit.status = VisitStatus.CHECKED_IN;
    await visit.save();
    return visit;
  }

  async completeVisit(
    visitId: string,
    data: CompleteVisitDto,
  ): Promise<{ visit: VisitDocument; encounterId: string }> {
    if (!Types.ObjectId.isValid(visitId)) {
      throw new BadRequestException('Invalid visitId');
    }

    const session = await this.visitModel.db.startSession();
    try {
      let completedVisit: VisitDocument | null = null;
      let encounterId = '';

      // Keep completion atomic so the visit, encounter, appointment, and time slot move together.
      await session.withTransaction(async () => {
        const visit = await this.visitModel.findById(visitId).session(session);
        if (!visit) {
          throw new NotFoundException('Visit not found');
        }

        if (visit.status !== VisitStatus.IN_PROGRESS) {
          throw new BadRequestException('Visit can only be COMPLETED from IN_PROGRESS');
        }

        const appointment = await this.appointmentModel
          .findById(visit.appointmentId)
          .select('appointmentStatus doctorId patientId timeSlot')
          .session(session)
          .exec();

        if (!appointment) {
          throw new NotFoundException('Appointment not found for visit');
        }

        if (!appointment.doctorId || !appointment.patientId) {
          throw new BadRequestException('Appointment is missing doctorId or patientId for visit completion');
        }

        const encounter = await this.medicalEncounterService.createVisitEncounter({
          visitId: visit._id,
          appointmentId: visit.appointmentId,
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          diagnosis: data.diagnosis,
          note: data.note,
          prescriptions: data.prescriptions,
          session,
        });

        if (appointment.timeSlot) {
          await this.timeSlotLogModel.updateOne(
            { _id: appointment.timeSlot },
            { $set: { status: 'completed' } },
            { session },
          );
        }

        await this.appointmentModel.updateOne(
          { _id: appointment._id },
          { $set: { appointmentStatus: AppointmentStatus.COMPLETED } },
          { session },
        );

        visit.status = VisitStatus.COMPLETED;
        visit.completedAt = Date.now();
        await visit.save({ session });

        completedVisit = visit;
        encounterId = encounter._id.toString();
      });

      if (!completedVisit) {
        throw new NotFoundException('Visit completion did not persist');
      }

      const committedVisit = completedVisit as VisitDocument;
      this.logger.log(`Visit ${visitId} completed with encounter ${encounterId}`);
      this.eventEmitter.emit('domain.visit.completed', {
        visitId: committedVisit._id.toString(),
        encounterId,
        completedAt: committedVisit.completedAt,
      });

      return { visit: completedVisit, encounterId };
    } finally {
      await session.endSession();
    }
  }

  async completeVisitByAppointmentId(
    appointmentId: string,
    data: CompleteVisitDto,
  ): Promise<{ visit: VisitDocument; encounterId: string }> {
    const visit = await this.visitModel.findOne({ appointmentId }).select('_id').lean().exec();
    if (!visit) {
      throw new NotFoundException('Visit not found for appointment');
    }

    return this.completeVisit(visit._id.toString(), data);
  }

  private assertStatusTransitionValid(
    currentStatus: VisitStatus,
    nextStatus: VisitStatus,
    appointmentStatus: AppointmentStatus,
  ) {
    if (
      nextStatus === VisitStatus.CHECKED_IN &&
      appointmentStatus !== AppointmentStatus.CONFIRMED
    ) {
      throw new BadRequestException(
        'Cannot check in visit when appointment is not CONFIRMED',
      );
    }

    if (nextStatus === VisitStatus.CHECKED_IN && currentStatus !== VisitStatus.CREATED) {
      throw new BadRequestException('Visit can only be CHECKED_IN from CREATED');
    }

    if (nextStatus === VisitStatus.IN_PROGRESS && currentStatus !== VisitStatus.CHECKED_IN) {
      throw new BadRequestException('Visit can only move to IN_PROGRESS from CHECKED_IN');
    }

    if (nextStatus === VisitStatus.COMPLETED && currentStatus !== VisitStatus.IN_PROGRESS) {
      throw new BadRequestException('Visit can only be COMPLETED from IN_PROGRESS');
    }

    if (nextStatus === VisitStatus.CREATED) {
      throw new BadRequestException('Visit status cannot move back to CREATED');
    }
  }
}
