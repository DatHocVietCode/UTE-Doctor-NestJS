import { Injectable, Logger } from '@nestjs/common';
import { AssistantChatRequestDto, AssistantChatResponseDto, AssistantMode } from './dto/assistant-chat.dto';

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly serviceUrl = (process.env.AI_CHAT_SERVICE_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '');
  private readonly timeoutMs = Number(process.env.AI_CHAT_TIMEOUT_MS ?? 90000);

  async chat(request: AssistantChatRequestDto): Promise<AssistantChatResponseDto> {
    const message = request.message.trim();
    const history = (request.history ?? [])
      .slice(-8)
      .map((turn) => ({
        role: turn.role,
        content: turn.content.trim(),
      }))
      .filter((turn) => turn.content.length > 0);

    const payload = {
      message,
      mode: request.mode ?? AssistantMode.GENERAL,
      history,
      imageDataUrl: request.imageDataUrl,
      imageFileName: request.imageFileName,
      imageMimeType: request.imageMimeType,
    };

    try {
      return await this.callPythonService(payload);
    } catch (error) {
      // Keep the web flow usable even when the Python service is offline.
      this.logger.warn(`Assistant fallback used: ${(error as Error).message}`);
      return this.buildFallbackResponse(request.mode ?? AssistantMode.GENERAL);
    }
  }

  async health(): Promise<{ status: 'ok'; source: 'python-service' | 'fallback' }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(`${this.serviceUrl}/health`, {
          method: 'GET',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Assistant health check failed with ${response.status}`);
        }

        return { status: 'ok', source: 'python-service' };
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return { status: 'ok', source: 'fallback' };
    }
  }

  async suggestions(mode: AssistantMode = AssistantMode.GENERAL): Promise<string[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(`${this.serviceUrl}/suggestions?mode=${encodeURIComponent(mode)}`, {
          method: 'GET',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Assistant suggestions failed with ${response.status}`);
        }

        const data = await response.json();
        if (Array.isArray(data?.suggestions) && data.suggestions.length > 0) {
          return data.suggestions.slice(0, 4);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      this.logger.warn(`Assistant suggestions fallback used: ${(error as Error).message}`);
    }

    return this.getSuggestions(mode);
  }

  private async callPythonService(payload: {
    message: string;
    mode: AssistantMode;
    history: { role: 'user' | 'assistant'; content: string }[];
    imageDataUrl?: string;
    imageFileName?: string;
    imageMimeType?: string;
  }): Promise<AssistantChatResponseDto> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.serviceUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Assistant service returned ${response.status}`);
      }

      const data = await response.json();
      return {
        reply: String(data?.reply ?? '').trim() || this.buildFallbackResponse(payload.mode).reply,
        mode: payload.mode,
        source: 'python-service',
        suggestions: Array.isArray(data?.suggestions) ? data.suggestions.slice(0, 4) : this.getSuggestions(payload.mode),
        warning: typeof data?.warning === 'string' ? data.warning : undefined,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildFallbackResponse(mode: AssistantMode): AssistantChatResponseDto {
    return {
      reply:
        'Hiện tại trợ lý AI chưa sẵn sàng. Hãy mô tả ngắn gọn triệu chứng, thời gian xuất hiện và tiền sử liên quan để bác sĩ có thể tư vấn chính xác hơn.',
      mode,
      source: 'fallback',
      suggestions: this.getSuggestions(mode),
      warning: 'AI service is not reachable right now.',
    };
  }

  private getSuggestions(mode: AssistantMode): string[] {
    if (mode === AssistantMode.DERMATOLOGY) {
      return [
        'Tôi hiện đang có các triệu chứng như nổi mụn sưng đỏ, cứng, có mủ trắng ở mặt. Tôi có thể đang bị bệnh gì?',
        'Tôi đang cảm thấy vùng da đỏ, ngứa và bong tróc. Tôi có thể đang bị bệnh gì?',
        'Tôi hiện đang có các triệu chứng như da xuất hiện các nốt mụn nhỏ, phẳng, màu hồng hoặc nâu. Tôi có thể đang bị bệnh gì?',
        'Tôi muốn kiểm tra da liễu để đánh giá tình trạng nốt ruồi. Tôi có thể đang bị bệnh gì?',
      ];
    }

    if (mode === AssistantMode.APPOINTMENT) {
      return [
        'Tôi muốn đặt khám chuyên khoa phù hợp với triệu chứng của mình',
        'Làm sao chọn bác sĩ đúng chuyên khoa?',
        'Cần chuẩn bị gì trước khi đi khám bệnh?',
        'Bác sĩ nào còn lịch khám trong tuần này?',
      ];
    }

    return [
      'Tôi hiện đang có các triệu chứng như sốt cao, đau đầu và mệt mỏi. Tôi có thể đang bị bệnh gì?',
      'Tôi đang cảm thấy ho kéo dài, đau họng và sổ mũi. Tôi có thể đang bị bệnh gì?',
      'Tôi hiện đang có các triệu chứng như đau bụng, tiêu chảy và buồn nôn. Tôi có thể đang bị bệnh gì?',
      'Tôi hay bị chóng mặt, hoa mắt khi đứng dậy đột ngột. Tôi có thể đang bị bệnh gì?',
    ];
  }
}