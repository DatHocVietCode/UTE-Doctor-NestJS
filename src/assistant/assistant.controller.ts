import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { DataResponse } from 'src/common/dto/data-respone';
import { ResponseCode } from 'src/common/enum/reponse-code.enum';
import { AssistantChatRequestDto, AssistantChatResponseDto, AssistantMode } from './dto/assistant-chat.dto';
import { AssistantService } from './assistant.service';

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('chat')
  async chat(@Body() body: AssistantChatRequestDto): Promise<DataResponse<AssistantChatResponseDto>> {
    const data = await this.assistantService.chat(body);
    return {
      code: ResponseCode.SUCCESS,
      message: 'Assistant reply generated',
      data,
    };
  }

  @Get('health')
  async health(): Promise<DataResponse<{ status: 'ok'; source: 'python-service' | 'fallback' }>> {
    const data = await this.assistantService.health();
    return {
      code: ResponseCode.SUCCESS,
      message: 'Assistant health check',
      data,
    };
  }

  @Get('suggestions')
  async suggestions(@Query('mode') mode?: AssistantMode): Promise<DataResponse<{ mode: AssistantMode; suggestions: string[] }>> {
    const resolvedMode = mode ?? AssistantMode.GENERAL;
    const suggestions = await this.assistantService.suggestions(resolvedMode);
    return {
      code: ResponseCode.SUCCESS,
      message: 'Assistant suggestions',
      data: {
        mode: resolvedMode,
        suggestions,
      },
    };
  }
}