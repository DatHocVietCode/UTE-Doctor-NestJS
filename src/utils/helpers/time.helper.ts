const ISO_WITH_TIMEZONE_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type ParseIsoOptions = {
  allowLegacyNoTimezone?: boolean;
  fallbackOffsetMinutes?: number;
  logPrefix?: string;
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
