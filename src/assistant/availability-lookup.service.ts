import { Injectable } from '@nestjs/common';
import { ChuyenKhoaService } from 'src/chuyen-khoa/chuyenkhoa.service';
import { DoctorService } from 'src/doctor/doctor.service';
import { TimeSlotDto } from 'src/timeslot/dtos/timeslot.dto';
import { TimeSlotStatusEnum } from 'src/timeslot/enums/timeslot-status.enum';
import { normalizeVietnamese } from './availability-intent.parser';
import {
  AvailabilitySlot,
  AvailabilityTimeOfDay,
  DoctorAvailabilitySummary,
  DoctorResolution,
  DoctorSummary,
  SpecialtyResolution,
  SpecialtySummary,
} from './availability.types';

type SpecialtyRecord = {
  _id?: unknown;
  id?: unknown;
  name?: unknown;
};

type DoctorSearchRecord = {
  id?: unknown;
  _id?: unknown;
  name?: unknown;
  email?: unknown;
  specialtyId?: unknown;
  chuyenKhoaId?: unknown;
  doctorName?: unknown;
  profileId?: {
    name?: unknown;
  };
  raw?: {
    _id?: unknown;
    chuyenKhoaId?: unknown;
    profileId?: {
      name?: unknown;
    };
  };
};

@Injectable()
export class AvailabilityLookupService {
  constructor(
    private readonly doctorService: DoctorService,
    private readonly chuyenKhoaService: ChuyenKhoaService,
  ) {}

  async listSpecialties(): Promise<SpecialtySummary[]> {
    const response = await this.chuyenKhoaService.findAll();
    const specialties: SpecialtyRecord[] = Array.isArray(response.data)
      ? (response.data as SpecialtyRecord[])
      : [];

    return specialties
      .map((specialty) => ({
        id: toSafeString(specialty._id ?? specialty.id),
        name: toSafeString(specialty.name).trim(),
      }))
      .filter((specialty) => specialty.id && specialty.name);
  }

  resolveSpecialty(
    specialtyName: string | undefined,
    specialties: SpecialtySummary[],
  ): SpecialtyResolution {
    const query = normalizeVietnamese(specialtyName ?? '');
    if (!query) {
      return { type: 'not_found' };
    }

    const exactMatches = specialties.filter(
      (specialty) => normalizeVietnamese(specialty.name) === query,
    );
    if (exactMatches.length === 1) {
      return { type: 'single', specialty: exactMatches[0] };
    }

    const looseMatches = specialties.filter((specialty) => {
      const normalizedName = normalizeVietnamese(specialty.name);
      return normalizedName.includes(query) || query.includes(normalizedName);
    });

    if (looseMatches.length === 1) {
      return { type: 'single', specialty: looseMatches[0] };
    }

    if (looseMatches.length > 1) {
      return { type: 'multiple', specialties: looseMatches.slice(0, 5) };
    }

    return { type: 'not_found' };
  }

  async resolveDoctor(
    doctorName: string | undefined,
    specialties: SpecialtySummary[],
  ): Promise<DoctorResolution> {
    const query = doctorName?.trim();
    if (!query) {
      return { type: 'not_found' };
    }

    const response = await this.doctorService.searchDoctors({ keyword: query });
    const doctors = this.formatDoctors(response?.data ?? [], specialties);

    if (doctors.length === 0) {
      return { type: 'not_found' };
    }

    const normalizedQuery = normalizeVietnamese(query);
    const exactMatches = doctors.filter(
      (doctor) => normalizeVietnamese(doctor.name) === normalizedQuery,
    );
    if (exactMatches.length === 1) {
      return { type: 'single', doctor: exactMatches[0] };
    }

    if (doctors.length === 1) {
      return { type: 'single', doctor: doctors[0] };
    }

    return { type: 'multiple', doctors: doctors.slice(0, 5) };
  }

  async listDoctorsBySpecialty(
    specialty: SpecialtySummary,
    specialties: SpecialtySummary[],
  ): Promise<DoctorSummary[]> {
    const response = await this.doctorService.searchDoctors({
      specialtyId: specialty.id,
      keyword: '',
    });

    return this.formatDoctors(response?.data ?? [], specialties);
  }

  async getAvailableSlotsForDoctor(
    doctorId: string,
    date: string,
    timeOfDay?: AvailabilityTimeOfDay,
  ): Promise<{
    allSlots: AvailabilitySlot[];
    matchingSlots: AvailabilitySlot[];
  }> {
    const response = await this.doctorService.getTimeSlotsByDoctorAndDate(
      doctorId,
      date,
      TimeSlotStatusEnum.AVAILABLE,
    );
    const allSlots = this.formatSlots(response?.data ?? []);

    return {
      allSlots,
      matchingSlots: timeOfDay
        ? allSlots.filter((slot) => isSlotInTimeOfDay(slot, timeOfDay))
        : allSlots,
    };
  }

  async getAvailabilityForSpecialty(
    specialty: SpecialtySummary,
    date: string,
    timeOfDay: AvailabilityTimeOfDay | undefined,
    specialties: SpecialtySummary[],
  ): Promise<DoctorAvailabilitySummary[]> {
    const doctors = await this.listDoctorsBySpecialty(specialty, specialties);
    const availability: DoctorAvailabilitySummary[] = [];

    for (const doctor of doctors) {
      const { matchingSlots } = await this.getAvailableSlotsForDoctor(
        doctor.id,
        date,
        timeOfDay,
      );
      if (matchingSlots.length > 0) {
        availability.push({
          doctor,
          availableSlots: matchingSlots,
        });
      }
    }

    return availability;
  }

  async findNearestDoctorAvailability(params: {
    doctor: DoctorSummary;
    startDate: string;
    days: number;
    timeOfDay?: AvailabilityTimeOfDay;
  }): Promise<{ date: string; availableSlots: AvailabilitySlot[] } | null> {
    for (let offset = 0; offset < params.days; offset += 1) {
      const date = addDays(params.startDate, offset);
      const { matchingSlots } = await this.getAvailableSlotsForDoctor(
        params.doctor.id,
        date,
        params.timeOfDay,
      );

      if (matchingSlots.length > 0) {
        return { date, availableSlots: matchingSlots };
      }
    }

    return null;
  }

  async findNearestSpecialtyAvailability(params: {
    specialty: SpecialtySummary;
    startDate: string;
    days: number;
    timeOfDay?: AvailabilityTimeOfDay;
    specialties: SpecialtySummary[];
  }): Promise<{ date: string; doctors: DoctorAvailabilitySummary[] } | null> {
    for (let offset = 0; offset < params.days; offset += 1) {
      const date = addDays(params.startDate, offset);
      const doctors = await this.getAvailabilityForSpecialty(
        params.specialty,
        date,
        params.timeOfDay,
        params.specialties,
      );

      if (doctors.length > 0) {
        return { date, doctors };
      }
    }

    return null;
  }

  private formatDoctors(
    rawDoctors: unknown[],
    specialties: SpecialtySummary[],
  ): DoctorSummary[] {
    const specialtyById = new Map(
      specialties.map((specialty) => [specialty.id, specialty.name]),
    );

    return rawDoctors
      .map((value) => {
        const doctor = value as DoctorSearchRecord;
        const specialtyId = toSafeString(
          doctor.specialtyId ?? doctor.chuyenKhoaId ?? doctor.raw?.chuyenKhoaId,
        );

        return {
          id: toSafeString(doctor.id ?? doctor._id ?? doctor.raw?._id),
          name: toSafeString(
            doctor.name ??
              doctor.profileId?.name ??
              doctor.raw?.profileId?.name ??
              doctor.doctorName,
          ).trim(),
          email: doctor.email ? toSafeString(doctor.email) : undefined,
          specialtyId: specialtyId || null,
          specialtyName: specialtyId
            ? (specialtyById.get(specialtyId) ?? null)
            : null,
        };
      })
      .filter((doctor) => doctor.id && doctor.name);
  }

  private formatSlots(slots: TimeSlotDto[]): AvailabilitySlot[] {
    return slots
      .map((slot) => {
        const startTime = String(slot.start ?? '').trim();
        const endTime = String(slot.end ?? '').trim();
        const label =
          startTime && endTime
            ? `${startTime} - ${endTime}`
            : String(slot.label ?? '').trim();

        return {
          timeSlotId: String(slot.id ?? '').trim(),
          startTime,
          endTime,
          label,
        };
      })
      .filter((slot) => slot.timeSlotId && slot.startTime && slot.endTime);
  }
}

function isSlotInTimeOfDay(
  slot: AvailabilitySlot,
  timeOfDay: AvailabilityTimeOfDay,
): boolean {
  const hour = Number(slot.startTime.slice(0, 2));
  if (!Number.isFinite(hour)) {
    return false;
  }

  if (timeOfDay === 'morning') {
    return hour < 12;
  }

  if (timeOfDay === 'afternoon') {
    return hour >= 12 && hour < 17;
  }

  return hour >= 17;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toSafeString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  if (typeof value === 'object') {
    const objectIdLike = value as { toHexString?: () => string };
    if (typeof objectIdLike.toHexString === 'function') {
      return objectIdLike.toHexString();
    }
  }

  return '';
}
