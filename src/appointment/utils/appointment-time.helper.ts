import { DateTimeHelper } from 'src/utils/helpers/datetime.helper';

export type AppointmentTimeWindow = {
  scheduledAt: number;
  startTime: number;
  endTime: number;
};

export type AppointmentTimeSlotLike = {
  start: string;
  end: string;
};

type ResolveAppointmentTimeOptions = {
  fallbackOffsetMinutes?: number;
  logPrefix?: string;
};

export class AppointmentTimeHelper {
  static readonly DEFAULT_OFFSET_MINUTES = 7 * 60;

  static resolveTimeWindow(
    dateInput: unknown,
    timeSlot: AppointmentTimeSlotLike,
    options: ResolveAppointmentTimeOptions = {},
  ): AppointmentTimeWindow {
    const parsedDate = this.parseDateInput(dateInput, options);
    const offsetMinutes = options.fallbackOffsetMinutes ?? this.DEFAULT_OFFSET_MINUTES;
    const dateKey = this.toLocalDateKey(parsedDate, offsetMinutes);
    const startTime = this.combineDateKeyAndClockToUtcEpoch(dateKey, timeSlot.start, offsetMinutes);
    const endTime = this.combineDateKeyAndClockToUtcEpoch(dateKey, timeSlot.end, offsetMinutes);

    return {
      scheduledAt: startTime,
      startTime,
      endTime,
    };
  }

  static resolveStoredScheduledAt(appointment: { scheduledAt?: unknown; date?: unknown }): number | null {
    if (typeof appointment.scheduledAt === 'number' && Number.isFinite(appointment.scheduledAt)) {
      return appointment.scheduledAt;
    }

    if (typeof appointment.date === 'number' && Number.isFinite(appointment.date)) {
      return appointment.date;
    }

    const fallbackDate = DateTimeHelper.toUtcDate(appointment.date);
    return fallbackDate ? fallbackDate.getTime() : null;
  }

  static getUtcDayRangeForLocalDate(
    dateInput: unknown = new Date(),
    options: ResolveAppointmentTimeOptions = {},
  ): { startEpoch: number; endEpoch: number; dateKey: string } {
    const parsedDate = this.parseDateInput(dateInput, options);
    const offsetMinutes = options.fallbackOffsetMinutes ?? this.DEFAULT_OFFSET_MINUTES;
    const dateKey = this.toLocalDateKey(parsedDate, offsetMinutes);
    const startEpoch = this.combineDateKeyAndClockToUtcEpoch(dateKey, '00:00', offsetMinutes);

    return {
      startEpoch,
      endEpoch: startEpoch + 24 * 60 * 60 * 1000,
      dateKey,
    };
  }

  static toLocalDateKey(date: Date, offsetMinutes: number = this.DEFAULT_OFFSET_MINUTES): string {
    const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
    const year = shifted.getUTCFullYear();
    const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const day = String(shifted.getUTCDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private static parseDateInput(dateInput: unknown, options: ResolveAppointmentTimeOptions): Date {
    const parsedDate = DateTimeHelper.toUtcDate(dateInput);
    if (!parsedDate) {
      const label = options.logPrefix ?? '[AppointmentTimeWarning]';
      throw new Error(`${label} Invalid date input`);
    }

    return parsedDate;
  }

  private static combineDateKeyAndClockToUtcEpoch(
    dateKey: string,
    clock: string,
    offsetMinutes: number,
  ): number {
    const dateMatch = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const clockMatch = clock.match(/^(\d{2}):(\d{2})$/);

    if (!dateMatch || !clockMatch) {
      throw new Error('Invalid date or time slot input');
    }

    const [, year, month, day] = dateMatch;
    const [, hour, minute] = clockMatch;

    return Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      0,
      0,
    ) - offsetMinutes * 60_000;
  }
}