import { Logger } from '@nestjs/common';
import { CircuitBreaker } from '../../common/resilience/circuit-breaker';

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmReasoningResult {
  answer: string;
  suggestedQuestions: string[];
}

const logger = new Logger('LlmReasoningEngine');

/**
 * Circuit Breaker protecting outbound Google Gemini API calls.
 * After 3 consecutive failures/timeouts, trips OPEN for 30s so AI Analyst
 * falls back immediately to the Local Math Engine (OLS + Z-Score) instead of hanging.
 */
export const geminiCircuitBreaker = new CircuitBreaker({
  name: 'Google-Gemini-API',
  failureThreshold: 3,
  cooldownMs: 30_000,
});

/**
 * Gọi Google Gemini LLM API theo cơ chế Grounded RAG
 * Tối ưu hóa siêu tốc: thinkingBudget = 0, timeout 12000ms, ưu tiên gemini-3.1-flash-lite & gemini-3-flash-preview
 * Tự động chuyển model dự phòng ngay khi gặp 503/429/404, fallback an toàn về Local Engine.
 */
export async function generateGroundedLlmResponse(params: {
  question: string;
  history?: ChatHistoryMessage[];
  groundedContext: Record<string, unknown>;
}): Promise<LlmReasoningResult | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const envModel = process.env.GEMINI_MODEL?.trim();
  const candidateModels: string[] = [];

  // Nếu người dùng cấu hình model hợp lệ (không phải các bản đã bị Google khai tử 404), đưa vào danh sách ưu tiên
  if (
    envModel &&
    envModel !== 'gemini-2.5-flash' &&
    envModel !== 'gemini-2.0-flash' &&
    envModel !== 'gemini-1.5-flash'
  ) {
    candidateModels.push(envModel);
  }

  // Model siêu tốc (phản hồi ~1.1-2.3s) và model dự phòng (~3.8s)
  if (!candidateModels.includes('gemini-3.1-flash-lite')) {
    candidateModels.push('gemini-3.1-flash-lite');
  }
  if (!candidateModels.includes('gemini-3-flash-preview')) {
    candidateModels.push('gemini-3-flash-preview');
  }

  const systemInstruction = `Bạn là SmartExpress AI Analyst — Chuyên gia phân tích dữ liệu vận hành & chiến lược logistics cho hệ thống SmartExpress.
Quy tắc trả lời:
- Trả lời tự nhiên, linh hoạt, sắc sảo, đi thẳng vào câu hỏi như Giám đốc Vận hành thực thụ, KHÔNG dùng mẫu câu rập khuôn lặp lại.
- CHỈ dùng số liệu thật trong GROUNDED_DATABASE_CONTEXT (từ MySQL, OLS Linear Regression, Z-Score), tuyệt đối không bịa số liệu hay tên tài xế/khách hàng.
- Nếu kỳ hỏi có 0 đơn nhưng allTimeStats có dữ liệu, nêu rõ kỳ đó chưa phát sinh đơn và phân tích dựa trên bức tranh toàn thời gian.
- Nếu người dùng hỏi mở rộng (định hướng, chiến lược tăng doanh số, so sánh các tháng, xử lý đơn thất bại, hỏi nối tiếp câu trước), kết hợp tư duy quản trị logistics với số liệu thật để đề xuất hành động cụ thể.
- Trình bày gọn bằng Markdown (**chữ đậm** cho số liệu, gạch đầu dòng - ).`;

  // Convert tối đa 8 tin nhắn gần nhất từ params.history sang mảng contents của Gemini API
  const historyMessages = (params.history || []).slice(-8);
  const contents: Array<{
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
  }> = historyMessages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  // Thêm phần tử user cuối cùng chứa groundedContext và câu hỏi hiện tại
  const promptPayload = `GROUNDED_DATABASE_CONTEXT (Dữ liệu thật từ MySQL & OLS):
${JSON.stringify(params.groundedContext, null, 2)}

CÂU HỎI CỦA NGƯỜI DÙNG: ${params.question}`;

  contents.push({
    role: 'user',
    parts: [{ text: promptPayload }],
  });

  return geminiCircuitBreaker.execute<LlmReasoningResult | null>(
    async () => {
      for (const model of candidateModels) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: systemInstruction }],
              },
              contents,
              generationConfig: {
                thinkingConfig: { thinkingBudget: 0 },
                temperature: 0.4,
                maxOutputTokens: 800,
              },
            }),
            signal: controller.signal,
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            logger.warn(`Gemini API model '${model}' failed with status ${res.status}: ${errText}`);
            // Chuyển ngay sang model dự phòng tiếp theo nếu gặp 404, 503 hoặc 429
            if (res.status === 404 || res.status === 503 || res.status === 429) {
              continue;
            }
            throw new Error(`Gemini API HTTP ${res.status}`);
          }

          const data = (await res.json()) as {
            candidates?: Array<{
              content?: {
                parts?: Array<{ text?: string }>;
              };
            }>;
          };

          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text && text.trim().length > 0) {
            return {
              answer: text.trim(),
              suggestedQuestions: [
                'So sánh doanh thu giữa các tháng gần đây?',
                'Phân tích nguyên nhân giao thất bại & cách khắc phục?',
                'Đề xuất chiến lược tăng trưởng đơn hàng tháng tới?',
              ],
            };
          } else {
            logger.warn(`Gemini API model '${model}' returned empty text response`);
            continue;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`Gemini API request '${model}' failed or timed out: ${message}`);
        } finally {
          clearTimeout(timeoutId);
        }
      }

      throw new Error('All Gemini candidate models failed or timed out');
    },
    () => null,
  );
}
