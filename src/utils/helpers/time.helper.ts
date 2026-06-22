import { DateTimeHelper } from './datetime.helper';

const ISO_WITH_TIMEZONE_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type ParseIsoOptions = {
  allowLegacyNoTimezone?: boolean;
  fallbackOffsetMinutes?: number;
  logPrefix?: string;
};

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export class TimeHelper {
  static readonly SERVER_TIMEZONE = 'Asia/Ho_Chi_Minh';
  private static readonly DEFAULT_FALLBACK_OFFSET_MINUTES = 7 * 60;

  static isIsoWithTimezone(value: string): boolean {
    return ISO_WITH_TIMEZONE_REGEX.test(value.trim());
  }

  static parseISOToUTC(dateString: string, options: ParseIsoOptions = {}): Date {
    const raw = typeof dateString === 'string' ? dateString.trim() : '';
    if (!raw) {
      throw new Error('Datetime is required');
    }

    if (this.isIsoWithTimezone(raw)) {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid datetime format: ${dateString}`);
      }
      return parsed;
    }

    if (!options.allowLegacyNoTimezone) {
      throw new Error(`Datetime must be ISO 8601 with timezone: ${dateString}`);
    }

    const legacy = this.parseLegacyWithoutTimezone(raw, options);
    console.warn(
      `${options.logPrefix ?? '[TimeWarning]'} Missing timezone, fallback applied`,
      {
        input: dateString,
        timezone: this.SERVER_TIMEZONE,
        parsedUtc: legacy.toISOString(),
      },
    );

    return legacy;
  }

  static toEpoch(date: Date): number {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new Error('Invalid Date for epoch conversion');
    }
    return date.getTime();
  }

  static fromEpoch(epoch: number): Date {
    if (!Number.isFinite(epoch)) {
      throw new Error(`Invalid epoch value: ${epoch}`);
    }
    const date = new Date(epoch);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid epoch value: ${epoch}`);
    }
    return date;
  }

  static toUtcDateOnly(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  static toTimezoneDateOnly(date: Date, offsetMinutes = this.DEFAULT_FALLBACK_OFFSET_MINUTES): string {
    const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
    return this.toUtcDateOnly(shifted);
  }

  static getTimezoneDayRange(
    dateInput: unknown = new Date(),
    offsetMinutes = this.DEFAULT_FALLBACK_OFFSET_MINUTES,
  ): { startEpoch: number; endEpoch: number; dateKey: string } {
    const parsed = DateTimeHelper.toUtcDate(dateInput);
    if (!parsed) {
      throw new Error('Invalid date input');
    }

    const dateKey = this.toTimezoneDateOnly(parsed, offsetMinutes);
    const [year, month, day] = dateKey.split('-').map(Number);
    const startEpoch = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMinutes * 60_000;

    return {
      startEpoch,
      endEpoch: startEpoch + 24 * 60 * 60 * 1000,
      dateKey,
    };
  }

  static getIanaTimezoneDayRange(
    dateInput: unknown = new Date(),
    timezone?: string,
  ): {
    startEpoch: number;
    endEpoch: number;
    dateKey: string;
    timezone: string;
  } {
    const parsed = DateTimeHelper.toUtcDate(dateInput);
    if (!parsed) {
      throw new Error('Invalid date input');
    }

    const resolvedTimezone = this.resolveIanaTimezone(timezone);
    const localDate = this.getZonedDateParts(parsed, resolvedTimezone);
    const nextLocalDate = new Date(
      Date.UTC(localDate.year, localDate.month - 1, localDate.day + 1),
    );
    const startEpoch = this.zonedDateTimeToUtcEpoch(
      {
        ...localDate,
        hour: 0,
        minute: 0,
        second: 0,
      },
      resolvedTimezone,
    );
    const endEpoch = this.zonedDateTimeToUtcEpoch(
      {
        year: nextLocalDate.getUTCFullYear(),
        month: nextLocalDate.getUTCMonth() + 1,
        day: nextLocalDate.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0,
      },
      resolvedTimezone,
    );

    return {
      startEpoch,
      endEpoch,
      dateKey: [
        localDate.year,
        String(localDate.month).padStart(2, '0'),
        String(localDate.day).padStart(2, '0'),
      ].join('-'),
      timezone: resolvedTimezone,
    };
  }

  static debugLog(tag: string, payload: Record<string, unknown>) {
    console.log(tag, payload);
  }

  static combineDateAndTimeSlotToUtcEpoch(date: string, timeSlot: string): number {
    const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const timeMatch = timeSlot.match(/^(\d{2}):(\d{2})$/);

    if (!dateMatch || !timeMatch) {
      throw new Error('date must be YYYY-MM-DD and timeSlot must be HH:mm');
    }

    const [, y, m, d] = dateMatch;
    const [, hh, mm] = timeMatch;

    const localMillis = Date.UTC(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hh),
      Number(mm),
      0,
      0,
    );

    // Server-defined timezone for local date+time inputs: Asia/Ho_Chi_Minh (UTC+7).
    return localMillis - this.DEFAULT_FALLBACK_OFFSET_MINUTES * 60_000;
  }

  private static resolveIanaTimezone(timezone?: string): string {
    const candidate = typeof timezone === 'string' ? timezone.trim() : '';
    if (!candidate) {
      return this.SERVER_TIMEZONE;
    }

    try {
      // Construction is the platform-supported validation step for IANA zone identifiers.
      new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format();
      return candidate;
    } catch {
      return this.SERVER_TIMEZONE;
    }
  }

  private static getZonedDateParts(
    date: Date,
    timezone: string,
  ): ZonedDateParts {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );

    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
    };
  }

  private static zonedDateTimeToUtcEpoch(
    target: ZonedDateParts,
    timezone: string,
  ): number {
    const targetAsUtc = Date.UTC(
      target.year,
      target.month - 1,
      target.day,
      target.hour,
      target.minute,
      target.second,
    );
    let candidate = targetAsUtc;

    // Re-evaluate the offset to handle zones whose offset changes around this local date.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const actual = this.getZonedDateParts(new Date(candidate), timezone);
      const actualAsUtc = Date.UTC(
        actual.year,
        actual.month - 1,
        actual.day,
        actual.hour,
        actual.minute,
        actual.second,
      );
      const adjusted = candidate + (targetAsUtc - actualAsUtc);
      if (adjusted === candidate) {
        break;
      }
      candidate = adjusted;
    }

    return candidate;
  }

  private static parseLegacyWithoutTimezone(input: string, options: ParseIsoOptions): Date {
    const match = input.match(
      /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
    );

    if (!match) {
      throw new Error(`Invalid datetime format: ${input}`);
    }

    const [, y, m, d, hh, mm, ss = '00', sss = '0'] = match;
    const fallbackOffsetMinutes =
      options.fallbackOffsetMinutes ?? this.DEFAULT_FALLBACK_OFFSET_MINUTES;

    const utcMillis =
      Date.UTC(
        Number(y),
        Number(m) - 1,
        Number(d),
        Number(hh),
        Number(mm),
        Number(ss),
        Number(sss.padEnd(3, '0')),
      ) -
      fallbackOffsetMinutes * 60_000;

    const parsed = new Date(utcMillis);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid datetime format: ${input}`);
    }

    return parsed;
  }
}
