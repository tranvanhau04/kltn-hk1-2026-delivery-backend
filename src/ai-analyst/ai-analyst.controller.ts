import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { AiAnalystService } from './ai-analyst.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../entities/user.entity';

@Controller('ai-analyst')
@Roles(UserRole.ADMIN, UserRole.DISPATCHER)
export class AiAnalystController {
  constructor(private readonly aiAnalystService: AiAnalystService) {}

  /**
   * GET /ai-analyst/insights
   * Trả về toàn bộ chỉ số dự báo hồi quy tuyến tính, Z-Score đỉnh tải và khuyến nghị chuyên gia
   */
  @Get('insights')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async getInsights(@Query('days') days?: string, @Query('period') period?: string) {
    let numDays = Number(days);
    if (!numDays || isNaN(numDays)) {
      if (period === 'month' || period === '30' || period === '30d') numDays = 30;
      else if (period === 'custom' || period === '90' || period === '90d') numDays = 90;
      else if (period === 'week' || period === '7' || period === '7d') numDays = 7;
      else numDays = Number(period) || 7;
    }
    return this.aiAnalystService.getInsights(numDays);
  }

  /**
   * POST /ai-analyst/chat
   * Trợ lý ảo AI Hybrid Agentic RAG (Gemini + OLS + Z-Score) với trí nhớ hội thoại & fallback an toàn
   */
  @Post('chat')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async chat(@Body() dto: ChatMessageDto) {
    const question = (dto.question || dto.message || '').trim();

    let numDays = dto.days;
    const lower = question.toLowerCase();
    if (
      lower.includes('thang nay') ||
      lower.includes('tháng này') ||
      lower.includes('30 ngay') ||
      lower.includes('30 ngày')
    ) {
      numDays = 30;
    } else if (
      lower.includes('90 ngay') ||
      lower.includes('90 ngày') ||
      lower.includes('quy nay') ||
      lower.includes('quý này')
    ) {
      numDays = 90;
    } else if (
      lower.includes('tuan nay') ||
      lower.includes('tuần này') ||
      lower.includes('7 ngay') ||
      lower.includes('7 ngày')
    ) {
      numDays = 7;
    }

    if (!numDays) {
      if (dto.period === 'month' || dto.period === '30' || dto.period === '30d') numDays = 30;
      else if (dto.period === 'custom' || dto.period === '90' || dto.period === '90d') numDays = 90;
      else if (dto.period === 'week' || dto.period === '7' || dto.period === '7d') numDays = 7;
      else numDays = 7;
    }

    const period = dto.period || `${numDays}d`;

    return this.aiAnalystService.chat({
      question,
      period,
      days: numDays,
      history: dto.history || [],
    });
  }
}
