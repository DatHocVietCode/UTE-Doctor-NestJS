export class DateTimeHelper {
  static nowUtc(): Date {
    return new Date();
  }

  static toUtcDate(input: unknown): Date | null {
    if (input === null || input === undefined) return null;

    if (input instanceof Date) {
      const copy = new Date(input.getTime());
      return this.isValidDate(copy) ? copy : null;
    }

    if (typeof input === "number") {
      const fromNumber = new Date(input);
      return this.isValidDate(fromNumber) ? fromNumber : null;
    }

    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed) return null;

      const normalized = this.normalizeUtcString(trimmed);
      const parsed = new Date(normalized);
      return this.isValidDate(parsed) ? parsed : null;
    }

    return null;
  }

  static toUtcISOString(input: unknown): string | null {
    const date = this.toUtcDate(input);
    return date ? date.toISOString() : null;
  }

  static toUtcDateOnlyString(input: unknown): string | null {
    const date = this.toUtcDate(input);
    return date ? this.formatUtcDateOnly(date) : null;
  }

  static getUtcDateOnly(date: Date = new Date()): string {
    const normalized = this.toUtcDate(date) ?? new Date();
    return this.formatUtcDateOnly(normalized);
  }

  static formatUtcDateOnly(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  static formatUtc(
    input: unknown,
    locale: string = "en-GB",
    options: Intl.DateTimeFormatOptions = {}
  ): string | null {
    const date = this.toUtcDate(input);
    if (!date) return null;
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      ...options,
    });
    return formatter.format(date);
  }

  static getUtcLastDayOfMonth(year: number, month: number): number {
    const date = new Date(Date.UTC(year, month, 0));
    return date.getUTCDate();
  }

  private static isValidDate(date: Date): boolean {
    return !Number.isNaN(date.getTime());
  }

  private static normalizeUtcString(value: string): string {
    if (this.hasTimezoneInfo(value)) {
      return value;
    }

    if (this.isDateOnly(value)) {
      return `${value}T00:00:00.000Z`;
    }

    return `${value}Z`;
  }

  private static isDateOnly(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  private static hasTimezoneInfo(value: string): boolean {
    return /[zZ]|[+-]\d{2}:\d{2}$/.test(value);
  }
}
