import { Injectable } from '@nestjs/common';
import {
  AvailabilityParsedIntent,
  AvailabilityRange,
  AvailabilityTimeOfDay,
  SpecialtySummary,
} from './availability.types';

const DEFAULT_TIME_ZONE = 'Asia/Ho_Chi_Minh';

type DateParseResult = {
  date?: string;
  dateText?: string;
  range: AvailabilityRange;
  ambiguousDate?: boolean;
  dateInPast?: boolean;
};

@Injectable()
export class AvailabilityIntentParser {
  parse(
    question: string,
    options: {
      specialties?: SpecialtySummary[];
      now?: Date;
      timeZone?: string;
    } = {},
  ): AvailabilityParsedIntent {
    const normalizedQuestion = question.replace(/\s+/g, ' ').trim();
    const comparable = normalizeVietnamese(normalizedQuestion);
    const today = this.getTodayDateKey(
      options.now ?? new Date(),
      options.timeZone ?? DEFAULT_TIME_ZONE,
    );

    if (this.isMedicalQuestion(comparable)) {
      return {
        intent: 'OUT_OF_SCOPE_MEDICAL',
        range: 'single_day',
        needsFollowUp: false,
        parser: 'fallback',
      };
    }

    const doctorName = this.extractDoctorName(normalizedQuestion);
    const specialtyName = this.extractSpecialtyName(
      normalizedQuestion,
      comparable,
      options.specialties ?? [],
    );
    const dateInfo = this.extractDate(comparable, today);
    const timeOfDay = this.extractTimeOfDay(comparable);

    if (
      this.isBookingGuideQuestion(comparable) &&
      !this.hasAvailabilityCue(comparable)
    ) {
      return {
        intent: 'BOOKING_GUIDE',
        range: 'single_day',
        needsFollowUp: false,
        parser: 'fallback',
      };
    }

    let intent: AvailabilityParsedIntent['intent'] = 'INSUFFICIENT_INFORMATION';
    if (doctorName && specialtyName) {
      intent = 'DOCTOR_SPECIALTY_AVAILABILITY';
    } else if (doctorName) {
      intent = 'DOCTOR_AVAILABILITY';
    } else if (specialtyName) {
      intent = 'SPECIALTY_AVAILABILITY';
    } else if (dateInfo.date || dateInfo.range !== 'single_day') {
      intent = 'BROAD_AVAILABILITY';
    }

    const needsFollowUp =
      Boolean(dateInfo.ambiguousDate) ||
      (!dateInfo.date &&
        dateInfo.range === 'single_day' &&
        (intent === 'DOCTOR_AVAILABILITY' ||
          intent === 'SPECIALTY_AVAILABILITY' ||
          intent === 'DOCTOR_SPECIALTY_AVAILABILITY')) ||
      intent === 'BROAD_AVAILABILITY' ||
      intent === 'INSUFFICIENT_INFORMATION';

    return {
      intent,
      doctorName,
      specialtyName,
      dateText: dateInfo.dateText,
      date: dateInfo.date,
      timeOfDay,
      range: dateInfo.range,
      needsFollowUp,
      followUpQuestion: needsFollowUp
        ? this.buildFollowUpQuestion(intent, dateInfo)
        : undefined,
      ambiguousDate: dateInfo.ambiguousDate,
      dateInPast: dateInfo.dateInPast,
      parser: 'fallback',
    };
  }

  private extractDoctorName(question: string): string | undefined {
    const patterns = [
      /bác\s*sĩ\s+([^?.,]+)/iu,
      /bac\s*si\s+([^?.,]+)/iu,
      /\bbs\.?\s+([^?.,]+)/iu,
      /doctor\s+([^?.,]+)/iu,
    ];

    for (const pattern of patterns) {
      const match = question.match(pattern);
      const candidate = this.cleanDoctorCandidate(match?.[1]);
      if (candidate) {
        return candidate;
      }
    }

    return undefined;
  }

  private extractSpecialtyName(
    question: string,
    comparable: string,
    specialties: SpecialtySummary[],
  ): string | undefined {
    const explicitPatterns = [
      /chuyên\s*khoa\s+([^?.,]+)/iu,
      /chuyen\s*khoa\s+([^?.,]+)/iu,
      /\bkhoa\s+([^?.,]+)/iu,
    ];

    for (const pattern of explicitPatterns) {
      const match = question.match(pattern);
      const candidate = this.cleanSpecialtyCandidate(match?.[1]);
      if (candidate) {
        return candidate;
      }
    }

    const matchedSpecialty = specialties
      .filter((specialty) =>
        comparable.includes(normalizeVietnamese(specialty.name)),
      )
      .sort((a, b) => b.name.length - a.name.length)[0];

    return matchedSpecialty?.name;
  }

  private extractDate(comparable: string, today: string): DateParseResult {
    if (/\b(gan nhat|som nhat|luc nao gan nhat)\b/.test(comparable)) {
      return {
        range: 'next_14_days',
        dateText: 'gần nhất',
      };
    }

    if (/\b(tuan nay|trong tuan nay|7 ngay toi)\b/.test(comparable)) {
      return {
        range: 'next_7_days',
        dateText: 'tuần này',
      };
    }

    if (/\b(hom nay|ngay hom nay)\b/.test(comparable)) {
      return this.withPastCheck(
        {
          date: today,
          dateText: 'hôm nay',
          range: 'single_day',
        },
        today,
      );
    }

    if (/\b(ngay mai|sang mai|chieu mai|toi mai|\bmai\b)\b/.test(comparable)) {
      return {
        date: this.addDays(today, 1),
        dateText: 'ngày mai',
        range: 'single_day',
      };
    }

    const explicitDate = comparable.match(
      /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/,
    );
    if (explicitDate) {
      const currentYear = Number(today.slice(0, 4));
      const year = explicitDate[3]
        ? normalizeYear(Number(explicitDate[3]))
        : currentYear;
      const date = toDateKey(
        year,
        Number(explicitDate[2]),
        Number(explicitDate[1]),
      );

      if (!date) {
        return {
          range: 'single_day',
          dateText: explicitDate[0],
          ambiguousDate: true,
        };
      }

      return this.withPastCheck(
        {
          date,
          dateText: explicitDate[0],
          range: 'single_day',
        },
        today,
      );
    }

    const weekdayDate = this.extractWeekdayDate(comparable, today);
    if (weekdayDate) {
      return weekdayDate;
    }

    if (/\b(bua sau|hom do|luc do|cuoi tuan)\b/.test(comparable)) {
      return {
        range: 'single_day',
        ambiguousDate: true,
      };
    }

    return { range: 'single_day' };
  }

  private extractWeekdayDate(
    comparable: string,
    today: string,
  ): DateParseResult | undefined {
    const weekdayMatch = comparable.match(/\bthu\s*([2-7])\b/);
    const sunday = /\b(chu nhat|cn)\b/.test(comparable);

    if (!weekdayMatch && !sunday) {
      return undefined;
    }

    const targetDay = sunday ? 0 : Number(weekdayMatch?.[1]) - 1;
    const currentDay = getUtcDay(today);
    const daysUntil = (targetDay - currentDay + 7) % 7;
    const date = this.addDays(today, daysUntil);

    return {
      date,
      dateText: sunday ? 'chủ nhật' : `thứ ${weekdayMatch?.[1]}`,
      range: 'single_day',
    };
  }

  private extractTimeOfDay(
    comparable: string,
  ): AvailabilityTimeOfDay | undefined {
    if (/\b(sang|buoi sang)\b/.test(comparable)) {
      return 'morning';
    }

    if (/\b(chieu|buoi chieu)\b/.test(comparable)) {
      return 'afternoon';
    }

    if (/\b(toi|buoi toi|ngoai gio)\b/.test(comparable)) {
      return 'evening';
    }

    return undefined;
  }

  private buildFollowUpQuestion(
    intent: AvailabilityParsedIntent['intent'],
    dateInfo: DateParseResult,
  ): string {
    if (dateInfo.ambiguousDate) {
      return 'Mình cần bạn nói rõ ngày muốn kiểm tra, ví dụ "hôm nay", "ngày mai", "thứ 6" hoặc một ngày cụ thể.';
    }

    if (
      intent === 'DOCTOR_AVAILABILITY' ||
      intent === 'SPECIALTY_AVAILABILITY' ||
      intent === 'DOCTOR_SPECIALTY_AVAILABILITY'
    ) {
      return 'Mình cần biết bạn muốn kiểm tra lịch trống vào ngày nào. Bạn có thể hỏi "hôm nay", "ngày mai", "thứ 6" hoặc nhập ngày cụ thể.';
    }

    if (intent === 'BROAD_AVAILABILITY') {
      return 'Mình cần biết bạn muốn kiểm tra theo chuyên khoa hoặc bác sĩ nào trước. Nếu chưa chọn bác sĩ, bạn có thể đặt lịch theo chuyên khoa để lễ tân hỗ trợ phân công.';
    }

    return 'Mình cần biết bạn muốn kiểm tra lịch của bác sĩ hoặc chuyên khoa nào, và vào ngày nào.';
  }

  private cleanDoctorCandidate(value?: string): string | undefined {
    if (!value) return undefined;
    return cleanEntity(value, [
      /\s+(chuyên\s*khoa|chuyen\s*khoa|khoa)\s+.*$/iu,
      /\s+(hôm nay|hom nay|ngày mai|ngay mai|mai|ngày|ngay|thứ\s*[2-7]|thu\s*[2-7]|chủ nhật|chu nhat|bữa sau|bua sau|hôm đó|hom do|lúc đó|luc do|cuối tuần|cuoi tuan|sáng|sang|chiều|chieu|tối|toi|buổi|buoi|còn|con|trống|trong|lịch|lich|slot|giờ|gio|không|khong)\b.*$/iu,
    ]);
  }

  private cleanSpecialtyCandidate(value?: string): string | undefined {
    if (!value) return undefined;
    return cleanEntity(value, [
      /\s+(hôm nay|hom nay|ngày mai|ngay mai|mai|ngày|ngay|thứ\s*[2-7]|thu\s*[2-7]|chủ nhật|chu nhat|bữa sau|bua sau|hôm đó|hom do|lúc đó|luc do|cuối tuần|cuoi tuan|sáng|sang|chiều|chieu|tối|toi|buổi|buoi|còn|con|trống|trong|lịch|lich|slot|giờ|gio|không|khong)\b.*$/iu,
    ]);
  }

  private isMedicalQuestion(comparable: string): boolean {
    return [
      'bi benh gi',
      'toi bi gi',
      'chan doan',
      'chuan doan',
      'dieu tri',
      'uong thuoc',
      'ke thuoc',
      'toa thuoc',
      'don thuoc',
      'dau nguc',
      'dau dau',
      'sot',
      'trieu chung',
    ].some((term) => comparable.includes(term));
  }

  private isBookingGuideQuestion(comparable: string): boolean {
    return [
      'coc',
      'phi giu cho',
      'thanh toan',
      'vnpay',
      'bhyt',
      'bao hiem',
      'bat dau dat lich',
      'dat lich thi bat dau',
      'trang thai lich',
    ].some((term) => comparable.includes(term));
  }

  private hasAvailabilityCue(comparable: string): boolean {
    return [
      'con lich',
      'lich trong',
      'trong gio',
      'trong khong',
      'slot',
      'gio nao',
      'gan nhat',
      'co bac si',
      'bac si nao',
    ].some((term) => comparable.includes(term));
  }

  private withPastCheck(
    result: DateParseResult,
    today: string,
  ): DateParseResult {
    if (result.date && compareDateKey(result.date, today) < 0) {
      return {
        ...result,
        dateInPast: true,
      };
    }

    return result;
  }

  private getTodayDateKey(now: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);

    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    return `${year}-${month}-${day}`;
  }

  private addDays(dateKey: string, days: number): string {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
}

export function normalizeVietnamese(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanEntity(
  value: string,
  stopPatterns: RegExp[],
): string | undefined {
  let result = value.replace(/\s+/g, ' ').trim();
  for (const pattern of stopPatterns) {
    result = result.replace(pattern, '').trim();
  }

  result = result
    .replace(/^[:\-–—\s]+/, '')
    .replace(/[?.,;:]+$/g, '')
    .trim();

  return result.length > 0 ? result : undefined;
}

function normalizeYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

function toDateKey(
  year: number,
  month: number,
  day: number,
): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return date.toISOString().slice(0, 10);
}

function getUtcDay(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}

function compareDateKey(left: string, right: string): number {
  return left.localeCompare(right);
}
