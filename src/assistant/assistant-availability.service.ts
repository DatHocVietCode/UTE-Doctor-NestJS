import { Injectable } from '@nestjs/common';
import { AvailabilityIntentParser } from './availability-intent.parser';
import { AvailabilityLookupService } from './availability-lookup.service';
import {
  APPOINTMENT_BOOKING_GUIDE_SCOPE,
  APPOINTMENT_BOOKING_GUIDE_SOURCE,
} from './appointment-booking-guide.types';
import {
  AssistantAvailabilityData,
  AssistantAvailabilityResponse,
  AvailabilityParsedIntent,
  AvailabilityRange,
  AvailabilitySlot,
  AvailabilityTimeOfDay,
  DOCTOR_AVAILABILITY_SCOPE,
  DOCTOR_AVAILABILITY_SOURCE,
  DoctorAvailabilitySummary,
  DoctorSummary,
  SpecialtySummary,
} from './availability.types';
import { AskAvailabilityDto } from './dto/ask-availability.dto';

const DEFAULT_TIME_ZONE = 'Asia/Ho_Chi_Minh';

@Injectable()
export class AssistantAvailabilityService {
  constructor(
    private readonly intentParser: AvailabilityIntentParser,
    private readonly lookupService: AvailabilityLookupService,
  ) {}

  async ask(dto: AskAvailabilityDto): Promise<AssistantAvailabilityResponse> {
    const question = dto.question.replace(/\s+/g, ' ').trim();
    const specialties = await this.lookupService.listSpecialties();
    const parsed = this.intentParser.parse(question, { specialties });

    if (parsed.intent === 'OUT_OF_SCOPE_MEDICAL') {
      return this.buildResponse({
        answer:
          'Mình không thể chẩn đoán bệnh hoặc tư vấn điều trị. Nếu bạn đang có triệu chứng, hãy đặt lịch khám với bác sĩ để được đánh giá trực tiếp.',
        intent: parsed.intent,
        parsed,
      });
    }

    if (parsed.intent === 'BOOKING_GUIDE') {
      return this.buildResponse({
        answer:
          'Câu này thuộc hướng dẫn đặt lịch: lịch Dịch vụ thường cần thanh toán phí giữ chỗ qua VNPay, còn BHYT không yêu cầu đặt cọc. Bạn có thể dùng chế độ Booking để hỏi chi tiết từng bước đặt lịch.',
        intent: parsed.intent,
        parsed,
        source: APPOINTMENT_BOOKING_GUIDE_SOURCE,
        scope: APPOINTMENT_BOOKING_GUIDE_SCOPE,
      });
    }

    if (parsed.dateInPast && parsed.date) {
      return this.buildResponse({
        answer: `Ngày ${parsed.date} đã qua. Bạn vui lòng chọn hôm nay, ngày mai hoặc một ngày trong tương lai để mình kiểm tra lịch trống.`,
        intent: parsed.intent,
        parsed,
        data: { date: parsed.date, dateText: parsed.dateText },
      });
    }

    if (parsed.needsFollowUp) {
      return this.buildResponse({
        answer:
          parsed.followUpQuestion ??
          'Mình cần thêm thông tin để kiểm tra lịch trống.',
        intent: parsed.intent,
        parsed,
        data: {
          date: parsed.date,
          dateText: parsed.dateText,
          timeOfDay: parsed.timeOfDay,
          specialtyOptions: specialties.slice(0, 5),
        },
      });
    }

    if (
      parsed.intent === 'DOCTOR_AVAILABILITY' ||
      parsed.intent === 'DOCTOR_SPECIALTY_AVAILABILITY'
    ) {
      return this.handleDoctorAvailability(parsed, specialties);
    }

    if (parsed.intent === 'SPECIALTY_AVAILABILITY') {
      return this.handleSpecialtyAvailability(parsed, specialties);
    }

    return this.buildResponse({
      answer:
        'Mình cần biết bạn muốn kiểm tra lịch của bác sĩ hoặc chuyên khoa nào, và vào ngày nào.',
      intent: parsed.intent,
      parsed,
      data: { specialtyOptions: specialties.slice(0, 5) },
    });
  }

  private async handleDoctorAvailability(
    parsed: AvailabilityParsedIntent,
    specialties: SpecialtySummary[],
  ): Promise<AssistantAvailabilityResponse> {
    const doctorResolution = await this.lookupService.resolveDoctor(
      parsed.doctorName,
      specialties,
    );

    if (doctorResolution.type === 'not_found') {
      return this.buildResponse({
        answer: `Mình chưa tìm thấy bác sĩ "${parsed.doctorName}" trong hệ thống. Bạn có thể kiểm tra lại tên bác sĩ hoặc chọn chuyên khoa để mình tìm lịch trống.`,
        intent: parsed.intent,
        parsed,
        data: { specialtyOptions: specialties.slice(0, 5) },
      });
    }

    if (doctorResolution.type === 'multiple') {
      return this.buildResponse({
        answer: `Mình tìm thấy nhiều bác sĩ khớp với "${parsed.doctorName}". Bạn muốn kiểm tra bác sĩ nào?\n${formatDoctorOptions(doctorResolution.doctors)}`,
        intent: parsed.intent,
        parsed,
        data: { doctorOptions: doctorResolution.doctors },
      });
    }

    const doctor = doctorResolution.doctor;
    if (parsed.specialtyName) {
      const specialtyResolution = this.lookupService.resolveSpecialty(
        parsed.specialtyName,
        specialties,
      );

      if (specialtyResolution.type === 'not_found') {
        return this.buildResponse({
          answer: `Mình chưa tìm thấy chuyên khoa "${parsed.specialtyName}" trong hệ thống. Bạn có thể kiểm tra lại tên chuyên khoa hoặc chọn một chuyên khoa khác.`,
          intent: parsed.intent,
          parsed,
          data: { doctor, specialtyOptions: specialties.slice(0, 5) },
        });
      }

      if (specialtyResolution.type === 'multiple') {
        return this.buildResponse({
          answer: `Mình tìm thấy nhiều chuyên khoa khớp với "${parsed.specialtyName}". Bạn muốn kiểm tra chuyên khoa nào? ${specialtyResolution.specialties.map((item) => item.name).join(', ')}.`,
          intent: parsed.intent,
          parsed,
          data: { doctor, specialtyOptions: specialtyResolution.specialties },
        });
      }

      if (
        doctor.specialtyId &&
        doctor.specialtyId !== specialtyResolution.specialty.id
      ) {
        return this.buildResponse({
          answer: `Mình thấy bác sĩ ${doctor.name} không thuộc chuyên khoa ${specialtyResolution.specialty.name}. Bạn muốn kiểm tra lịch của bác sĩ ${doctor.name} hay kiểm tra các bác sĩ khác trong chuyên khoa ${specialtyResolution.specialty.name}?`,
          intent: parsed.intent,
          parsed,
          data: {
            doctor,
            specialty: specialtyResolution.specialty,
          },
        });
      }
    }

    if (!parsed.date && parsed.range !== 'single_day') {
      return this.handleNearestDoctorAvailability(parsed, doctor);
    }

    const date = parsed.date!;
    const { allSlots, matchingSlots } =
      await this.lookupService.getAvailableSlotsForDoctor(
        doctor.id,
        date,
        parsed.timeOfDay,
      );

    if (matchingSlots.length > 0) {
      return this.buildResponse({
        answer: `Bác sĩ ${doctor.name} còn các khung giờ ${formatSlots(matchingSlots)} vào ${formatDatePhrase(parsed)}${formatTimeOfDaySuffix(parsed.timeOfDay)}.`,
        intent: parsed.intent,
        parsed,
        data: {
          doctor,
          date,
          dateText: parsed.dateText,
          timeOfDay: parsed.timeOfDay,
          availableSlots: matchingSlots,
        },
      });
    }

    if (parsed.timeOfDay && allSlots.length > 0) {
      return this.buildResponse({
        answer: `Bác sĩ ${doctor.name} chưa có lịch trống ${formatTimeOfDay(parsed.timeOfDay)} vào ${formatDatePhrase(parsed)}. Các khung giờ khác còn trống: ${formatSlots(allSlots)}.`,
        intent: parsed.intent,
        parsed,
        data: {
          doctor,
          date,
          dateText: parsed.dateText,
          timeOfDay: parsed.timeOfDay,
          availableSlots: [],
          alternatives: allSlots.map((slot) => slot.label),
        },
      });
    }

    return this.buildResponse({
      answer: `Bác sĩ ${doctor.name} chưa có lịch trống vào ${formatDatePhrase(parsed)}. Bạn có thể chọn ngày khác hoặc đặt lịch theo chuyên khoa để lễ tân hỗ trợ phân công.`,
      intent: parsed.intent,
      parsed,
      data: {
        doctor,
        date,
        dateText: parsed.dateText,
        timeOfDay: parsed.timeOfDay,
        availableSlots: [],
        alternatives: [
          'Chọn ngày khác',
          'Chọn bác sĩ khác trong cùng chuyên khoa',
          'Đặt lịch theo chuyên khoa để lễ tân hỗ trợ phân công',
        ],
      },
    });
  }

  private async handleSpecialtyAvailability(
    parsed: AvailabilityParsedIntent,
    specialties: SpecialtySummary[],
  ): Promise<AssistantAvailabilityResponse> {
    const specialtyResolution = this.lookupService.resolveSpecialty(
      parsed.specialtyName,
      specialties,
    );

    if (specialtyResolution.type === 'not_found') {
      return this.buildResponse({
        answer: `Mình chưa tìm thấy chuyên khoa "${parsed.specialtyName}" trong hệ thống. Bạn có thể kiểm tra lại tên chuyên khoa hoặc chọn một chuyên khoa khác.`,
        intent: parsed.intent,
        parsed,
        data: { specialtyOptions: specialties.slice(0, 5) },
      });
    }

    if (specialtyResolution.type === 'multiple') {
      return this.buildResponse({
        answer: `Mình tìm thấy nhiều chuyên khoa khớp với "${parsed.specialtyName}". Bạn muốn kiểm tra chuyên khoa nào? ${specialtyResolution.specialties.map((item) => item.name).join(', ')}.`,
        intent: parsed.intent,
        parsed,
        data: { specialtyOptions: specialtyResolution.specialties },
      });
    }

    const specialty = specialtyResolution.specialty;
    if (!parsed.date && parsed.range !== 'single_day') {
      return this.handleNearestSpecialtyAvailability(
        parsed,
        specialty,
        specialties,
      );
    }

    const date = parsed.date!;
    const doctors = await this.lookupService.getAvailabilityForSpecialty(
      specialty,
      date,
      parsed.timeOfDay,
      specialties,
    );
    const visibleDoctors = limitDoctorAvailability(doctors);

    if (visibleDoctors.length > 0) {
      return this.buildResponse({
        answer: `Chuyên khoa ${specialty.name} còn lịch vào ${formatDatePhrase(parsed)}${formatTimeOfDaySuffix(parsed.timeOfDay)}:\n${formatDoctorAvailability(visibleDoctors)}`,
        intent: parsed.intent,
        parsed,
        data: {
          specialty,
          date,
          dateText: parsed.dateText,
          timeOfDay: parsed.timeOfDay,
          doctors: visibleDoctors,
        },
      });
    }

    return this.buildResponse({
      answer: `Chuyên khoa ${specialty.name} chưa có lịch trống vào ${formatDatePhrase(parsed)}${formatTimeOfDaySuffix(parsed.timeOfDay)}. Bạn có thể chọn ngày khác hoặc gửi yêu cầu đặt lịch theo chuyên khoa để lễ tân hỗ trợ phân công.`,
      intent: parsed.intent,
      parsed,
      data: {
        specialty,
        date,
        dateText: parsed.dateText,
        timeOfDay: parsed.timeOfDay,
        doctors: [],
        alternatives: [
          'Chọn ngày khác',
          'Đặt lịch theo chuyên khoa để lễ tân hỗ trợ phân công',
        ],
      },
    });
  }

  private async handleNearestDoctorAvailability(
    parsed: AvailabilityParsedIntent,
    doctor: DoctorSummary,
  ): Promise<AssistantAvailabilityResponse> {
    const startDate = parsed.date ?? todayDateKey();
    const days = rangeToDays(parsed.range);
    const nearest = await this.lookupService.findNearestDoctorAvailability({
      doctor,
      startDate,
      days,
      timeOfDay: parsed.timeOfDay,
    });

    if (!nearest) {
      return this.buildResponse({
        answer: `Mình chưa tìm thấy lịch trống gần nhất của bác sĩ ${doctor.name} trong ${days} ngày tới. Bạn có thể chọn ngày cụ thể khác hoặc đặt lịch theo chuyên khoa để lễ tân hỗ trợ phân công.`,
        intent: parsed.intent,
        parsed,
        data: { doctor, availableSlots: [] },
      });
    }

    return this.buildResponse({
      answer: `Lịch trống gần nhất của bác sĩ ${doctor.name} là ngày ${nearest.date}: ${formatSlots(nearest.availableSlots)}.`,
      intent: parsed.intent,
      parsed,
      data: {
        doctor,
        date: nearest.date,
        timeOfDay: parsed.timeOfDay,
        availableSlots: nearest.availableSlots,
      },
    });
  }

  private async handleNearestSpecialtyAvailability(
    parsed: AvailabilityParsedIntent,
    specialty: SpecialtySummary,
    specialties: SpecialtySummary[],
  ): Promise<AssistantAvailabilityResponse> {
    const startDate = parsed.date ?? todayDateKey();
    const days = rangeToDays(parsed.range);
    const nearest = await this.lookupService.findNearestSpecialtyAvailability({
      specialty,
      startDate,
      days,
      timeOfDay: parsed.timeOfDay,
      specialties,
    });

    if (!nearest) {
      return this.buildResponse({
        answer: `Mình chưa tìm thấy lịch trống gần nhất cho chuyên khoa ${specialty.name} trong ${days} ngày tới. Bạn có thể chọn ngày cụ thể khác hoặc gửi yêu cầu đặt lịch để lễ tân hỗ trợ phân công.`,
        intent: parsed.intent,
        parsed,
        data: { specialty, doctors: [] },
      });
    }

    const doctors = limitDoctorAvailability(nearest.doctors);
    return this.buildResponse({
      answer: `Lịch trống gần nhất của chuyên khoa ${specialty.name} là ngày ${nearest.date}:\n${formatDoctorAvailability(doctors)}`,
      intent: parsed.intent,
      parsed,
      data: {
        specialty,
        date: nearest.date,
        timeOfDay: parsed.timeOfDay,
        doctors,
      },
    });
  }

  private buildResponse(params: {
    answer: string;
    intent: AssistantAvailabilityResponse['intent'];
    parsed?: AvailabilityParsedIntent;
    data?: AssistantAvailabilityData;
    source?: AssistantAvailabilityResponse['source'];
    scope?: AssistantAvailabilityResponse['scope'];
  }): AssistantAvailabilityResponse {
    return {
      answer: params.answer,
      source: params.source ?? DOCTOR_AVAILABILITY_SOURCE,
      scope: params.scope ?? DOCTOR_AVAILABILITY_SCOPE,
      intent: params.intent,
      data: params.data ?? {},
      parser: params.parsed?.parser,
    };
  }
}

function formatDatePhrase(parsed: AvailabilityParsedIntent): string {
  return parsed.dateText && parsed.date
    ? `${parsed.dateText} (${parsed.date})`
    : (parsed.date ?? 'ngày đã chọn');
}

function formatSlots(slots: AvailabilitySlot[]): string {
  const visibleSlots = slots.slice(0, 5).map((slot) => slot.label);
  const suffix = slots.length > visibleSlots.length ? '...' : '';
  return `${visibleSlots.join(', ')}${suffix}`;
}

function formatDoctorAvailability(
  doctors: DoctorAvailabilitySummary[],
): string {
  return doctors
    .slice(0, 4)
    .map((item) => `- ${item.doctor.name}: ${formatSlots(item.availableSlots)}`)
    .join('\n');
}

function formatDoctorOptions(doctors: DoctorSummary[]): string {
  return doctors
    .slice(0, 5)
    .map((doctor) => {
      const specialty = doctor.specialtyName
        ? ` - ${doctor.specialtyName}`
        : '';
      return `- ${doctor.name}${specialty}`;
    })
    .join('\n');
}

function formatTimeOfDay(timeOfDay: AvailabilityTimeOfDay): string {
  if (timeOfDay === 'morning') return 'buổi sáng';
  if (timeOfDay === 'afternoon') return 'buổi chiều';
  return 'buổi tối';
}

function formatTimeOfDaySuffix(
  timeOfDay: AvailabilityTimeOfDay | undefined,
): string {
  return timeOfDay ? ` ${formatTimeOfDay(timeOfDay)}` : '';
}

function limitDoctorAvailability(
  doctors: DoctorAvailabilitySummary[],
): DoctorAvailabilitySummary[] {
  return doctors.slice(0, 5).map((item) => ({
    doctor: item.doctor,
    availableSlots: item.availableSlots.slice(0, 6),
  }));
}

function rangeToDays(range: AvailabilityRange): number {
  return range === 'next_7_days' ? 7 : 14;
}

function todayDateKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  return `${year}-${month}-${day}`;
}
