import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { Appointment, AppointmentDocument } from 'src/appointment/schemas/appointment.schema';
import { Review, ReviewDocument } from 'src/review/schema/review.schema';
import { Billing, BillingDocument } from 'src/billing/billing.schema';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import {
  AdminAnalyticsQueryDto,
  DoctorRevenueItem,
  FrequentPatientsResult,
  MedicationRankingItem,
  RevenueResult,
  SpecialtyRevenueItem,
  TopDoctorsResult,
  TopRatedDoctorsResult,
  TopSpecialtiesResult,
} from '../dto/admin-analytics.dto';
import {
  clampLimit,
  computeReviewWindow,
  computeScheduledWindow,
  mapFrequentPatientRow,
  windowMatch,
  windowMatchDate,
} from './admin-analytics.util';

// Read-only admin analytics. Each metric is a single aggregation over existing
// collections; joins use aggregation $lookup by collection name (default plurals:
// doctors / chuyenkhoas / patients / profiles / accounts / reviews).
const COMPLETED = 'COMPLETED';

@Injectable()
export class AdminAnalyticsService {
  constructor(
    @InjectModel(Appointment.name) private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(Review.name) private readonly reviewModel: Model<ReviewDocument>,
    @InjectModel(Billing.name) private readonly billingModel: Model<BillingDocument>,
  ) {}

  // Req 1 — most-visited specialty, keyed on the treating doctor's chuyenKhoaId
  // (fallback: Appointment.specialtyId). Both-null exams are excluded from the ranking
  // and tallied separately as unattributedCount.
  async topSpecialties(query: AdminAnalyticsQueryDto): Promise<DataResponse<TopSpecialtiesResult>> {
    const window = computeScheduledWindow(query.from, query.to, Date.now());
    const limit = clampLimit(query.limit);
    const pipeline: PipelineStage[] = [
      { $match: { appointmentStatus: COMPLETED, ...windowMatch('scheduledAt', window) } },
      { $lookup: { from: 'doctors', localField: 'doctorId', foreignField: '_id', as: 'doctor' } },
      { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: true } },
      { $addFields: { specialtyKey: { $ifNull: ['$doctor.chuyenKhoaId', '$specialtyId'] } } },
      {
        $facet: {
          ranked: [
            { $match: { specialtyKey: { $ne: null } } },
            { $group: { _id: '$specialtyKey', examCount: { $sum: 1 } } },
            { $sort: { examCount: -1 } },
            { $limit: limit },
            { $lookup: { from: 'chuyenkhoas', localField: '_id', foreignField: '_id', as: 'ck' } },
            { $unwind: { path: '$ck', preserveNullAndEmptyArrays: true } },
            { $project: { _id: 0, specialtyId: { $toString: '$_id' }, name: '$ck.name', examCount: 1 } },
          ],
          unattributed: [{ $match: { specialtyKey: null } }, { $count: 'count' }],
        },
      },
    ];
    const [facet] = await this.appointmentModel.aggregate(pipeline);
    const items = facet?.ranked ?? [];
    const unattributedCount = facet?.unattributed?.[0]?.count ?? 0;
    return { code: ResponseCode.SUCCESS, message: 'OK', data: { window, items, unattributedCount } };
  }

  // Req 2 — most-visited doctor by examination volume. The display name is resolved from
  // the doctor's linked Profile (Doctor.profileId → Profile.name); the schema's declared
  // `doctorName` field is not populated in practice. Response field stays `doctorName`.
  async topDoctors(query: AdminAnalyticsQueryDto): Promise<DataResponse<TopDoctorsResult>> {
    const window = computeScheduledWindow(query.from, query.to, Date.now());
    const limit = clampLimit(query.limit);
    const pipeline: PipelineStage[] = [
      { $match: { appointmentStatus: COMPLETED, doctorId: { $ne: null }, ...windowMatch('scheduledAt', window) } },
      { $group: { _id: '$doctorId', examCount: { $sum: 1 } } },
      { $sort: { examCount: -1 } },
      { $limit: limit },
      { $lookup: { from: 'doctors', localField: '_id', foreignField: '_id', as: 'doctor' } },
      { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'profiles', localField: 'doctor.profileId', foreignField: '_id', as: 'profile' } },
      { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, doctorId: { $toString: '$_id' }, doctorName: '$profile.name', examCount: 1 } },
    ];
    const items = await this.appointmentModel.aggregate(pipeline);
    return { code: ResponseCode.SUCCESS, message: 'OK', data: { window, items } };
  }

  // Req 3 — top-rated doctors: simple average of Review.rating (1–10) + reviewCount,
  // 0-review doctors excluded (they aren't in `reviews`), tie-break by reviewCount.
  // All-time by default; windowed on Review.createdAt only if from/to are passed.
  async topRatedDoctors(query: AdminAnalyticsQueryDto): Promise<DataResponse<TopRatedDoctorsResult>> {
    const window = computeReviewWindow(query.from, query.to);
    const windowOut = window.from === null && window.to === null ? null : window;
    const limit = clampLimit(query.limit);
    const match = windowMatch('createdAt', window);
    const pipeline: PipelineStage[] = [
      ...(Object.keys(match).length ? [{ $match: match }] : []),
      { $group: { _id: '$doctorId', avgRating: { $avg: '$rating' }, reviewCount: { $sum: 1 } } },
      { $sort: { avgRating: -1, reviewCount: -1 } },
      { $limit: limit },
      { $lookup: { from: 'doctors', localField: '_id', foreignField: '_id', as: 'doctor' } },
      { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'profiles', localField: 'doctor.profileId', foreignField: '_id', as: 'profile' } },
      { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          doctorId: { $toString: '$_id' },
          doctorName: '$profile.name',
          avgRating: { $round: ['$avgRating', 2] },
          reviewCount: 1,
        },
      },
    ];
    const items = await this.reviewModel.aggregate(pipeline);
    return { code: ResponseCode.SUCCESS, message: 'OK', data: { window: windowOut, items } };
  }

  // Req 4 — frequent patients by examination volume. Output is PII-compliant by
  // construction (name + status + accountId + examCount only) and null-safe against the
  // known Appointment.patientId integrity landmine (unresolved id → null fields, no throw).
  async frequentPatients(query: AdminAnalyticsQueryDto): Promise<DataResponse<FrequentPatientsResult>> {
    const window = computeScheduledWindow(query.from, query.to, Date.now());
    const limit = clampLimit(query.limit);
    const pipeline: PipelineStage[] = [
      { $match: { appointmentStatus: COMPLETED, patientId: { $ne: null }, ...windowMatch('scheduledAt', window) } },
      { $group: { _id: '$patientId', examCount: { $sum: 1 } } },
      { $sort: { examCount: -1 } },
      { $limit: limit },
      { $lookup: { from: 'patients', localField: '_id', foreignField: '_id', as: 'patient' } },
      { $unwind: { path: '$patient', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'profiles', localField: 'patient.profileId', foreignField: '_id', as: 'profile' } },
      { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'accounts', localField: 'patient.accountId', foreignField: '_id', as: 'account' } },
      { $unwind: { path: '$account', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          examCount: 1,
          patient: { _id: '$patient._id', accountId: '$patient.accountId' },
          profile: { name: '$profile.name' },
          account: { _id: '$account._id', status: '$account.status' },
        },
      },
    ];
    const rows = await this.appointmentModel.aggregate(pipeline);
    const items = rows.map(mapFrequentPatientRow);
    return { code: ResponseCode.SUCCESS, message: 'OK', data: { window, items } };
  }

  // Req 6 — revenue analytics. Base population: Billing.status === 'PAID' only (consultation
  // AND medication revenue both come exclusively from paid billings — a different, independent
  // pipeline from the exam-volume topDoctors/topSpecialties above, even though they currently
  // rank the same doctors). Windowed on Billing.createdAt (a real Date field) via
  // windowMatchDate, NOT scheduledAt — Billing has no reliable link back to the exam date.
  // A single $facet aggregation covers all five views in one round-trip.
  async revenue(query: AdminAnalyticsQueryDto): Promise<DataResponse<RevenueResult>> {
    const window = computeScheduledWindow(query.from, query.to, Date.now());
    const limit = clampLimit(query.limit);
    const dateMatch = windowMatchDate('createdAt', window);

    // Per-billing CLINIC medication line total, reused by the totals/byDoctor/bySpecialty branches.
    const medLineField = {
      $sum: {
        $map: {
          input: { $filter: { input: '$medications', as: 'm', cond: { $eq: ['$$m.source', 'CLINIC'] } } },
          as: 'm',
          in: '$$m.lineTotal',
        },
      },
    };

    const pipeline: PipelineStage[] = [
      { $match: { status: 'PAID', ...dateMatch } },
      { $addFields: { medLine: medLineField } },
      {
        $facet: {
          totals: [{ $group: { _id: null, consult: { $sum: '$consultationFee' }, med: { $sum: '$medLine' }, count: { $sum: 1 } } }],
          // Pre-limit count of distinct revenue-bearing doctors (decision 4's numerator —
          // must NOT be read off the post-$limit byDoctor branch below, or it would
          // silently under-report once revenue-bearing doctors exceed `limit`).
          byDoctorCount: [
            { $lookup: { from: 'visits', localField: 'visitId', foreignField: '_id', as: 'v' } },
            { $unwind: { path: '$v', preserveNullAndEmptyArrays: true } },
            { $group: { _id: '$v.doctorId' } },
            { $count: 'count' },
          ],
          byDoctor: [
            { $lookup: { from: 'visits', localField: 'visitId', foreignField: '_id', as: 'v' } },
            { $unwind: { path: '$v', preserveNullAndEmptyArrays: true } },
            {
              $group: {
                _id: '$v.doctorId',
                consult: { $sum: '$consultationFee' },
                med: { $sum: '$medLine' },
                billingCount: { $sum: 1 },
              },
            },
            { $addFields: { revenue: { $add: ['$consult', '$med'] } } },
            { $sort: { revenue: -1 } },
            { $limit: limit },
            { $lookup: { from: 'doctors', localField: '_id', foreignField: '_id', as: 'd' } },
            { $unwind: { path: '$d', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'profiles', localField: 'd.profileId', foreignField: '_id', as: 'p' } },
            { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 0,
                doctorId: { $toString: '$_id' },
                doctorName: '$p.name',
                consultationRevenue: '$consult',
                medicationRevenue: '$med',
                revenue: 1,
                billingCount: 1,
              },
            },
          ],
          // Pre-limit count of distinct revenue-bearing specialties (same reasoning as byDoctorCount).
          bySpecialtyCount: [
            { $lookup: { from: 'visits', localField: 'visitId', foreignField: '_id', as: 'v' } },
            { $unwind: { path: '$v', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'doctors', localField: 'v.doctorId', foreignField: '_id', as: 'd' } },
            { $unwind: { path: '$d', preserveNullAndEmptyArrays: true } },
            { $group: { _id: '$d.chuyenKhoaId' } },
            { $count: 'count' },
          ],
          bySpecialty: [
            { $lookup: { from: 'visits', localField: 'visitId', foreignField: '_id', as: 'v' } },
            { $unwind: { path: '$v', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'doctors', localField: 'v.doctorId', foreignField: '_id', as: 'd' } },
            { $unwind: { path: '$d', preserveNullAndEmptyArrays: true } },
            {
              $group: {
                _id: '$d.chuyenKhoaId',
                consult: { $sum: '$consultationFee' },
                med: { $sum: '$medLine' },
                billingCount: { $sum: 1 },
              },
            },
            { $addFields: { revenue: { $add: ['$consult', '$med'] } } },
            { $sort: { revenue: -1 } },
            { $limit: limit },
            { $lookup: { from: 'chuyenkhoas', localField: '_id', foreignField: '_id', as: 'ck' } },
            { $unwind: { path: '$ck', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 0,
                specialtyId: { $toString: '$_id' },
                name: '$ck.name',
                consultationRevenue: '$consult',
                medicationRevenue: '$med',
                revenue: 1,
                billingCount: 1,
              },
            },
          ],
          dispensed: [
            { $unwind: '$medications' },
            { $match: { 'medications.source': 'CLINIC' } },
            {
              $group: {
                _id: { $ifNull: ['$medications.medicineId', '$medications.medicineName'] },
                medicineName: { $first: '$medications.medicineName' },
                medicineId: { $first: '$medications.medicineId' },
                totalQty: { $sum: '$medications.dispensedQty' },
                lineCount: { $sum: 1 },
                revenue: { $sum: '$medications.lineTotal' },
              },
            },
            { $sort: { totalQty: -1, lineCount: -1 } },
            { $limit: limit },
            { $project: { _id: 0, medicineId: { $toString: '$medicineId' }, medicineName: 1, totalQty: 1, lineCount: 1, revenue: 1 } },
          ],
          external: [
            { $unwind: '$medications' },
            { $match: { 'medications.source': 'OUTSIDE_PURCHASE' } },
            {
              $group: {
                _id: { $ifNull: ['$medications.medicineId', '$medications.medicineName'] },
                medicineName: { $first: '$medications.medicineName' },
                medicineId: { $first: '$medications.medicineId' },
                totalQty: { $sum: '$medications.prescribedQty' },
                lineCount: { $sum: 1 },
              },
            },
            { $sort: { totalQty: -1, lineCount: -1 } },
            { $limit: limit },
            { $project: { _id: 0, medicineId: { $toString: '$medicineId' }, medicineName: 1, totalQty: 1, lineCount: 1 } },
          ],
        },
      },
    ];

    const [facet] = await this.billingModel.aggregate(pipeline);
    const totals = facet?.totals?.[0] ?? { consult: 0, med: 0, count: 0 };
    const byDoctor: DoctorRevenueItem[] = facet?.byDoctor ?? [];
    const bySpecialty: SpecialtyRevenueItem[] = facet?.bySpecialty ?? [];
    const topDispensedMedications: MedicationRankingItem[] = facet?.dispensed ?? [];
    // External-purchase lines are never charged (lineTotal always 0 by design) — a
    // count/frequency ranking, not a revenue one, so `revenue` is dropped from the shape.
    const topExternalMedications: MedicationRankingItem[] = (facet?.external ?? []).map((m: any) => {
      const { revenue: _revenue, ...rest } = m;
      return rest;
    });

    return {
      code: ResponseCode.SUCCESS,
      message: 'OK',
      data: {
        window,
        totalConsultationRevenue: totals.consult ?? 0,
        totalMedicationRevenue: totals.med ?? 0,
        totalRevenue: (totals.consult ?? 0) + (totals.med ?? 0),
        paidBillingCount: totals.count ?? 0,
        doctorsWithRevenueCount: facet?.byDoctorCount?.[0]?.count ?? 0,
        specialtiesWithRevenueCount: facet?.bySpecialtyCount?.[0]?.count ?? 0,
        byDoctor,
        bySpecialty,
        topDispensedMedications,
        topExternalMedications,
      },
    };
  }
}
