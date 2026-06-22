import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export enum AssistantMode {
  GENERAL = 'general',
  DERMATOLOGY = 'dermatology',
  APPOINTMENT = 'appointment',
}

export class AssistantChatTurnDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class AssistantChatRequestDto {
  @IsString()
  @MaxLength(4000)
  message!: string;

  @IsOptional()
  @IsString()
  imageDataUrl?: string;

  @IsOptional()
  @IsString()
  imageFileName?: string;

  @IsOptional()
  @IsString()
  imageMimeType?: string;

  @IsOptional()
  @IsEnum(AssistantMode)
  mode?: AssistantMode = AssistantMode.GENERAL;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssistantChatTurnDto)
  history?: AssistantChatTurnDto[];
}

export type AssistantChatResponseDto = {
  reply: string;
  mode: AssistantMode;
  source: 'python-service' | 'fallback' | 'image-classifier';
  suggestions: string[];
  imagePredictions?: {
    label: string;
    confidence: number;
  }[];
  warning?: string;
};