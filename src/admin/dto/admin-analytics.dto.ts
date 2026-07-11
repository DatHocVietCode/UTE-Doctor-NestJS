import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';
import { AnalyticsWindow, FrequentPatientItem } from '../services/admin-analytics.util';

// Shared query for the admin analytics endpoints. All optional.
// `from`/`to` are epoch-ms; their default behavior differs per metric (see the services):
// reqs 1/2/4 default to the last 3 months on scheduledAt; req 3 is all-time on Review.createdAt.
export class AdminAnalyticsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  from?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  to?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}

// ── Response shapes ───────────────────────────────────────────────────────────

export interface TopSpecialtyItem {
  specialtyId: string | null;
  name: string | null;
  examCount: number;
}
export interface TopSpecialtiesResult {
  window: AnalyticsWindow;
  items: TopSpecialtyItem[];
  unattributedCount: number;
}

export interface TopDoctorItem {
  doctorId: string;
  doctorName: string | null;
  examCount: number;
}
export interface TopDoctorsResult {
  window: AnalyticsWindow;
  items: TopDoctorItem[];
}

export interface TopRatedDoctorItem {
  doctorId: string;
  doctorName: string | null;
  avgRating: number;
  reviewCount: number;
}
export interface TopRatedDoctorsResult {
  window: AnalyticsWindow | null;
  items: TopRatedDoctorItem[];
}

export interface FrequentPatientsResult {
  window: AnalyticsWindow;
  items: FrequentPatientItem[];
}

// Req 6 — revenue analytics. All amounts are plain integer VND (no currency field/conversion).
// Base population: Billing.status === 'PAID' only, windowed on Billing.createdAt (NOT
// Appointment.scheduledAt — Billing has no reliable link back to the exam date).
export interface DoctorRevenueItem {
  doctorId: string;
  doctorName: string | null;
  consultationRevenue: number;
  medicationRevenue: number;
  revenue: number;
  billingCount: number;
}

export interface SpecialtyRevenueItem {
  specialtyId: string | null;
  name: string | null;
  consultationRevenue: number;
  medicationRevenue: number;
  revenue: number;
  billingCount: number;
}

// Shared shape for both medication rankings (top dispensed / top externally-purchased).
// `revenue` is omitted for externally-purchased lines: their lineTotal is always 0 by
// design (the clinic did not charge for them), so it would be a meaningless zero.
export interface MedicationRankingItem {
  medicineId: string | null;
  medicineName: string;
  totalQty: number;
  lineCount: number;
  revenue?: number;
}

export interface RevenueResult {
  window: AnalyticsWindow;
  totalConsultationRevenue: number;
  totalMedicationRevenue: number;
  totalRevenue: number;
  paidBillingCount: number;
  doctorsWithRevenueCount: number;
  specialtiesWithRevenueCount: number;
  byDoctor: DoctorRevenueItem[];
  bySpecialty: SpecialtyRevenueItem[];
  topDispensedMedications: MedicationRankingItem[];
  topExternalMedications: MedicationRankingItem[];
}
