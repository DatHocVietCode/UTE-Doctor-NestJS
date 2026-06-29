import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentBookingGuideService } from './appointment-booking-guide.service';
import {
  APPOINTMENT_BOOKING_GUIDE_SCOPE,
  APPOINTMENT_BOOKING_GUIDE_SOURCE,
} from './appointment-booking-guide.types';

const createService = (values: Record<string, string | undefined> = {}) => {
  const configService = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;

  return {
    service: new AppointmentBookingGuideService(configService),
    configService,
  };
};

describe('AppointmentBookingGuideService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads the Vietnamese appointment booking guide from disk', async () => {
    const { service } = createService();

    await expect(service.loadGuide()).resolves.toContain(
      'Hướng dẫn đặt lịch khám trong Doctor+',
    );
  });

  it('returns a clear configuration error when OPENAI_API_KEY is missing', async () => {
    const { service } = createService();
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    let thrown: unknown;

    try {
      await service.ask({
        question: 'Tôi muốn đặt lịch khám thì làm sao?',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ServiceUnavailableException);
    expect((thrown as ServiceUnavailableException).getResponse()).toMatchObject(
      {
        error: 'OPENAI_API_KEY_MISSING',
        source: APPOINTMENT_BOOKING_GUIDE_SOURCE,
        scope: APPOINTMENT_BOOKING_GUIDE_SCOPE,
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses diagnosis or treatment questions without calling OpenAI', async () => {
    const { service } = createService();
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    const result = await service.ask({
      question: 'Tôi sốt cao và đau đầu, tôi bị bệnh gì và nên uống thuốc gì?',
    });

    expect(result).toMatchObject({
      source: APPOINTMENT_BOOKING_GUIDE_SOURCE,
      scope: APPOINTMENT_BOOKING_GUIDE_SCOPE,
    });
    expect(result.answer).toContain('chỉ hướng dẫn cách đặt lịch khám');
    expect(result.answer).toContain('không chẩn đoán bệnh');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a quota-specific setup error when OpenAI reports insufficient quota', async () => {
    const { service } = createService({
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'test-model',
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      json: () =>
        Promise.resolve({
          error: {
            type: 'insufficient_quota',
            code: 'insufficient_quota',
            message: 'quota exceeded',
          },
        }),
    } as Response);

    let thrown: unknown;
    try {
      await service.ask({
        question: 'Tôi muốn đặt lịch khám thì bắt đầu ở đâu?',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ServiceUnavailableException);
    expect((thrown as ServiceUnavailableException).getResponse()).toMatchObject(
      {
        error: 'OPENAI_QUOTA_EXCEEDED',
        source: APPOINTMENT_BOOKING_GUIDE_SOURCE,
        scope: APPOINTMENT_BOOKING_GUIDE_SCOPE,
      },
    );
  });

  it('uses the guide and configured model for normal booking questions', async () => {
    const { service } = createService({
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'test-model',
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: 'Bạn bấm "Đăng ký khám", chọn chuyên khoa, bác sĩ, ngày khám và khung giờ còn trống.',
                },
              ],
            },
          ],
        }),
    } as Response);

    const result = await service.ask({
      question: 'Tôi muốn đặt lịch khám Dịch vụ thì làm sao?',
    });

    expect(result).toEqual({
      answer:
        'Bạn bấm "Đăng ký khám", chọn chuyên khoa, bác sĩ, ngày khám và khung giờ còn trống.',
      source: APPOINTMENT_BOOKING_GUIDE_SOURCE,
      scope: APPOINTMENT_BOOKING_GUIDE_SCOPE,
      model: 'test-model',
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit & {
      body: string;
    };
    const parsedBody: unknown = JSON.parse(request.body);
    const body = parsedBody as {
      model: string;
      input: string;
      instructions: string;
    };

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const headers = request.headers as { Authorization?: string };
    expect(headers.Authorization).toBe('Bearer test-key');
    expect(body.model).toBe('test-model');
    expect(body.input).toBe('Tôi muốn đặt lịch khám Dịch vụ thì làm sao?');
    expect(body.instructions).toContain('TÀI LIỆU HƯỚNG DẪN ĐẶT LỊCH');
    expect(body.instructions).toContain('Không chẩn đoán bệnh');
    expect(body.instructions).toContain('Không nhắc route frontend');
  });

  it('does not expose raw route paths or implementation terms in patient-facing answers', async () => {
    const { service } = createService({
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'test-model',
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          output_text:
            'Vào /user/my-profile?tab=appointments hoặc /appointments/broad. Endpoint này không cần API payload.',
        }),
    } as Response);

    const result = await service.ask({
      question: 'Tôi muốn đặt lịch khám thì bắt đầu từ đâu?',
    });

    expect(result.answer).toContain('bấm nút "Đăng ký khám"');
    expect(result.answer).not.toMatch(/\/user\/|\/appointments\/|\?tab=/);
    expect(result.answer).not.toMatch(/endpoint|DTO|API payload/i);
  });
});
