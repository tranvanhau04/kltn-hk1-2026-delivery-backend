import { IsOptional, IsString, IsNumber, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export interface ChatHistoryItemDto {
  role: 'user' | 'assistant';
  content: string;
}

export class ChatMessageDto {
  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  question?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  days?: number;

  @IsOptional()
  @IsString()
  period?: string;

  @IsOptional()
  @IsArray()
  history?: ChatHistoryItemDto[];
}
