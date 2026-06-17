import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Appointment, AppointmentDocument } from 'src/appointment/schemas/appointment.schema';
import { AppointmentAssignmentTask, AppointmentAssignmentTaskDocument } from 'src/appointment/schemas/appointment-assignment-task.schema';
import { Payment, PaymentDocument } from 'src/payment/schemas/payment.schema';
import { Visit, VisitDocument } from 'src/visit/schemas/visit.schema';
import { MedicalEncounter, MedicalEncounterDocument } from 'src/patient/schema/medical-record.schema';
import { Billing, BillingDocument } from 'src/billing/billing.schema';
import { TimeSlotLog, TimeSlotLogDocument } from 'src/timeslot/schemas/timeslot-log.schema';
import { CreditTransaction, CreditTransactionDocument } from 'src/wallet/credit/schemas/credit-transaction.schema';
import { CoinTransaction, CoinTransactionDocument } from 'src/wallet/coin/schemas/coin-transaction.schema';
import { Notification, NotificationDocument } from 'src/notification/schemas/notification.schema';
import { Doctor, DoctorDocument } from 'src/doctor/schema/doctor.schema';
import { Patient, PatientDocument } from 'src/patient/schema/patient.schema';
import { Account, AccountDocument } from 'src/account/schemas/account.schema';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { DataResponse } from 'src/common/dto/data-respone';
import { ActorLookups, emptyLookups, LifecycleBundle } from '../dto/lifecycle-bundle';
import { AdminAppointmentListQueryDto } from '../dto/admin-appointment-list.query.dto';
import { AdminAppointmentListResult, AdminAppointmentSummary } from '../dto/admin-appointment-summary.dto';
import { LifecycleTree } from '../dto/lifecycle-tree.dto';
import { reconstructLifecycle } from './lifecycle-phase-builders';
import { normalizeTimestamp } from './lifecycle-time.util';

interface BundleAndTree {
  appointment: any;
  bundle: LifecycleBundle;
  tree: LifecycleTree;
}

@Injectable()
export class AppointmentLifecycleService {
  private readonly logger = new Logger(AppointmentLifecycleService.name);

  constructor(
    @InjectModel(Appointment.name) private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(AppointmentAssignmentTask.name) private readonly taskModel: Model<AppointmentAssignmentTaskDocument>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Visit.name) private readonly visitModel: Model<VisitDocument>,
    @InjectModel(MedicalEncounter.name) private readonly encounterModel: Model<MedicalEncounterDocument>,
    @InjectModel(Billing.name) private readonly billingModel: Model<BillingDocument>,
    @InjectModel(TimeSlotLog.name) private readonly slotModel: Model<TimeSlotLogDocument>,
    @InjectModel(CreditTransaction.name) private readonly creditModel: Model<CreditTransactionDocument>,
    @InjectModel(CoinTransaction.name) private readonly coinModel: Model<CoinTransactionDocument>,
    @InjectModel(Notification.name) private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(Doctor.name) private readonly doctorModel: Model<DoctorDocument>,
    @InjectModel(Patient.name) private readonly patientModel: Model<PatientDocument>,
    @InjectModel(Account.name) private readonly accountModel: Model<AccountDocument>,
  ) {}

  // Run a query in isolation: a rejected branch records its name and yields a fallback,
  // so one broken/legacy collection can never fail the whole lifecycle.
  private async safe<T>(name: string, p: Promise<T>, fallback: T, failed: string[]): Promise<T> {
    try {
      const r = await p;
      return (r ?? fallback) as T;
    } catch (err) {
      this.logger.warn(`lifecycle branch '${name}' failed: ${String(err)}`);
      failed.push(name);
      return fallback;
    }
  }

  private idIn(value: unknown): Types.ObjectId | string {
    const s = String(value ?? '');
    return Types.ObjectId.isValid(s) ? new Types.ObjectId(s) : s;
  }

  async getBundleAndTree(id: string): Promise<BundleAndTree> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Appointment not found');
    }
    const appointment = await this.appointmentModel
      .findById(id)
      .lean()
      .exec()
      .catch(() => null);
    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    const bundle = await this.loadBundle(appointment);
    const tree = reconstructLifecycle(bundle);
    return { appointment, bundle, tree };
  }

  async getLifecycle(id: string): Promise<DataResponse<LifecycleTree>> {
    const { tree } = await this.getBundleAndTree(id);
    return { code: ResponseCode.SUCCESS, message: 'OK', data: tree };
  }

  private async loadBundle(appointment: any): Promise<LifecycleBundle> {
    const failed: string[] = [];
    const apptKey = this.idIn(appointment._id);
    const apptIdStr = String(appointment._id);

    // Phase 1: appointment-keyed branches.
    const [depositPayments, assignmentTasks, visit, encounter, creditTransactions, coinTransactions] = await Promise.all([
      this.safe('depositPayments', this.paymentModel.find({ appointmentId: apptKey, purpose: 'APPOINTMENT_DEPOSIT' }).lean().exec(), [], failed),
      this.safe('assignmentTasks', this.taskModel.find({ appointmentId: apptKey }).lean().exec(), [], failed),
      this.safe('visit', this.visitModel.findOne({ appointmentId: apptKey }).lean().exec(), null, failed),
      this.safe('encounter', this.encounterModel.findOne({ appointmentId: apptKey }).lean().exec(), null, failed),
      this.safe('creditTransactions', this.creditModel.find({ appointmentId: apptKey }).lean().exec(), [], failed),
      this.safe('coinTransactions', this.coinModel.find({ appointmentId: apptKey }).lean().exec(), [], failed),
    ]);

    // Phase 2: records keyed by visit/slot, and best-effort notifications.
    const visitId = (visit as any)?._id;
    const [encounterByVisit, billing, timeSlot, notifications] = await Promise.all([
      encounter
        ? Promise.resolve(null)
        : visitId
          ? this.safe('encounterByVisit', this.encounterModel.findOne({ visitId: this.idIn(visitId) }).lean().exec(), null, failed)
          : Promise.resolve(null),
      visitId
        ? this.safe('billing', this.billingModel.findOne({ visitId: this.idIn(visitId) }).lean().exec(), null, failed)
        : Promise.resolve(null),
      appointment.timeSlot
        ? this.safe('timeSlot', this.slotModel.findById(this.idIn(appointment.timeSlot)).lean().exec(), null, failed)
        : Promise.resolve(null),
      this.safe(
        'notifications',
        this.notificationModel
          .find({ $or: [{ 'data.appointmentId': apptIdStr }, { idempotencyKey: new RegExp(`:${apptIdStr}:`) }] })
          .limit(50)
          .lean()
          .exec(),
        [],
        failed,
      ),
    ]);

    const resolvedEncounter = encounter ?? encounterByVisit;

    // Phase 3: billing payments (keyed by billing id).
    const billingId = (billing as any)?._id;
    const billingPayments = billingId
      ? await this.safe('billingPayments', this.paymentModel.find({ billingId: this.idIn(billingId) }).lean().exec(), [], failed)
      : [];

    const lookups = await this.loadLookups(
      { appointment, visit, encounter: resolvedEncounter, assignmentTasks: assignmentTasks as any[] },
      failed,
    );

    return {
      appointment,
      depositPayments: depositPayments as any[],
      billingPayments: billingPayments as any[],
      assignmentTasks: assignmentTasks as any[],
      visit,
      encounter: resolvedEncounter,
      billing,
      timeSlot,
      creditTransactions: creditTransactions as any[],
      coinTransactions: coinTransactions as any[],
      notifications: notifications as any[],
      lookups,
      failedBranches: failed,
    };
  }

  private async loadLookups(
    src: { appointment: any; visit: any; encounter: any; assignmentTasks: any[] },
    failed: string[],
  ): Promise<ActorLookups> {
    const lookups = emptyLookups();
    const doctorIds = new Set<string>();
    const accountIds = new Set<string>();
    const patientIds = new Set<string>();

    const addId = (set: Set<string>, v: unknown) => {
      if (v === null || v === undefined) return;
      const s = String(v);
      if (Types.ObjectId.isValid(s)) set.add(s);
    };

    addId(doctorIds, src.appointment?.doctorId);
    addId(doctorIds, src.visit?.doctorId);
    addId(doctorIds, src.encounter?.createdByDoctorId);
    addId(accountIds, src.encounter?.createdByAccountId);
    addId(patientIds, src.appointment?.patientId);
    for (const t of src.assignmentTasks ?? []) {
      addId(accountIds, t?.acceptedByReceptionistId);
      for (const h of t?.history ?? []) addId(accountIds, h?.by);
    }

    const toMap = (docs: any[]) => {
      const m = new Map<string, any>();
      for (const d of docs ?? []) m.set(String(d._id), d);
      return m;
    };

    const [doctors, accounts, patients] = await Promise.all([
      doctorIds.size
        ? this.safe('doctorLookup', this.doctorModel.find({ _id: { $in: [...doctorIds] } }).lean().exec(), [], failed)
        : Promise.resolve([]),
      accountIds.size
        ? this.safe('accountLookup', this.accountModel.find({ _id: { $in: [...accountIds] } }).lean().exec(), [], failed)
        : Promise.resolve([]),
      patientIds.size
        ? this.safe('patientLookup', this.patientModel.find({ _id: { $in: [...patientIds] } }).lean().exec(), [], failed)
        : Promise.resolve([]),
    ]);

    lookups.doctors = toMap(doctors as any[]);
    lookups.accounts = toMap(accounts as any[]);
    lookups.patients = toMap(patients as any[]);
    return lookups;
  }

  // ── Admin appointment list ─────────────────────────────────────────────
  async listAppointments(query: AdminAppointmentListQueryDto): Promise<DataResponse<AdminAppointmentListResult>> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const filter: Record<string, any> = {};
    if (query.status) filter.appointmentStatus = query.status;
    if (query.paymentCategory) filter.paymentCategory = query.paymentCategory;
    if (query.assignmentStatus) filter.assignmentStatus = query.assignmentStatus;
    if (query.depositStatus) filter.depositStatus = query.depositStatus;
    if (query.doctorId && Types.ObjectId.isValid(query.doctorId)) filter.doctorId = new Types.ObjectId(query.doctorId);
    if (query.patientEmail) filter.patientEmail = query.patientEmail;
    if (query.dateFrom || query.dateTo) {
      filter.scheduledAt = {};
      if (query.dateFrom) filter.scheduledAt.$gte = query.dateFrom;
      if (query.dateTo) filter.scheduledAt.$lte = query.dateTo;
    }

    const sort = this.parseSort(query.sort);

    const [items, total] = await Promise.all([
      this.appointmentModel.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.appointmentModel.countDocuments(filter).exec(),
    ]);

    const summaries = await this.toSummaries(items as any[]);
    return {
      code: ResponseCode.SUCCESS,
      message: 'OK',
      data: { items: summaries, page, limit, total: total as number },
    };
  }

  private parseSort(sort?: string): Record<string, 1 | -1> {
    const allowed = new Set(['bookingDate', 'scheduledAt', 'updatedAt', 'createdAt']);
    if (!sort) return { bookingDate: -1 };
    const [field, dir] = sort.split(':');
    if (!allowed.has(field)) return { bookingDate: -1 };
    return { [field]: dir === 'asc' ? 1 : -1 };
  }

  private async toSummaries(appointments: any[]): Promise<AdminAppointmentSummary[]> {
    if (!appointments.length) return [];
    const failed: string[] = [];
    const visitByAppt = new Map<string, any>();
    const doctorById = new Map<string, any>();

    const apptIds = appointments.map((a) => this.idIn(a._id));
    const doctorIds = [...new Set(appointments.map((a) => a.doctorId).filter(Boolean).map(String))].filter((s) => Types.ObjectId.isValid(s));

    const [visits, doctors] = await Promise.all([
      this.safe('listVisits', this.visitModel.find({ appointmentId: { $in: apptIds } }).lean().exec(), [], failed),
      doctorIds.length
        ? this.safe('listDoctors', this.doctorModel.find({ _id: { $in: doctorIds } }).lean().exec(), [], failed)
        : Promise.resolve([]),
    ]);
    for (const v of visits as any[]) visitByAppt.set(String(v.appointmentId), v);
    for (const d of doctors as any[]) doctorById.set(String(d._id), d);

    // Billing keyed by the resolved visit ids.
    const visitIds = (visits as any[]).map((v) => this.idIn(v._id));
    const billingByVisit = new Map<string, any>();
    if (visitIds.length) {
      const billings = await this.safe('listBillings', this.billingModel.find({ visitId: { $in: visitIds } }).lean().exec(), [], failed);
      for (const b of billings as any[]) billingByVisit.set(String(b.visitId), b);
    }

    return appointments.map((a) => {
      const apptId = String(a._id);
      const visit = visitByAppt.get(apptId);
      const billing = visit ? billingByVisit.get(String(visit._id)) : null;
      const doctor = a.doctorId ? doctorById.get(String(a.doctorId)) : null;
      return {
        appointmentId: apptId,
        patient: a.patientEmail ? { email: a.patientEmail } : null,
        doctor: a.doctorId ? { id: String(a.doctorId), name: doctor?.name } : null,
        appointmentStatus: a.appointmentStatus,
        assignmentStatus: a.assignmentStatus,
        depositStatus: a.depositStatus,
        paymentCategory: a.paymentCategory,
        visitStatus: visit?.status ?? null,
        billingStatus: billing?.status ?? null,
        bookingDate: normalizeTimestamp(a.bookingDate),
        scheduledAt: normalizeTimestamp(a.scheduledAt),
        hasWarnings: a.appointmentStatus === 'COMPLETED' && !visit,
      };
    });
  }
}
