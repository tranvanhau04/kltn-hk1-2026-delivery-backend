export enum AnalystIntent {
  GROWTH_STRATEGY = 'GROWTH_STRATEGY',
  REVENUE = 'REVENUE',
  TOP_DRIVERS = 'TOP_DRIVERS',
  TOP_CUSTOMERS = 'TOP_CUSTOMERS',
  FORECAST = 'FORECAST',
  PEAK_DAY = 'PEAK_DAY',
  OPERATIONS = 'OPERATIONS',
  RECOMMENDATIONS = 'RECOMMENDATIONS',
  GREETING = 'GREETING',
  UNKNOWN = 'UNKNOWN',
}

export type TimeRangeType =
  | 'ALL_TIME'
  | 'SPECIFIC_DATE'
  | 'SPECIFIC_MONTH'
  | 'SPECIFIC_QUARTER'
  | 'SPECIFIC_YEAR'
  | 'RELATIVE_DAYS'
  | 'DEFAULT';

export interface TimeRangeResult {
  startDate: Date | null;
  endDate: Date | null;
  label: string;
  type: TimeRangeType;
  isAutoFallback?: boolean;
}

export interface IntentClassificationResult {
  primaryIntent: AnalystIntent;
  intents: AnalystIntent[];
  confidence: number;
  matchedKeywords: string[];
  normalizedQuery: string;
  timeRange: TimeRangeResult;
}

export class NlpIntentEngine {
  /**
   * Chuẩn hoá chuỗi tiếng Việt chuẩn 100%:
   * Chuyển chữ thường, đổi đ/Đ thành d, tách NFD, gỡ dấu thanh điệu, rút gọn khoảng trắng
   */
  static normalizeText(str: string): string {
    return str
      .toLowerCase()
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Sửa các lỗi gõ phím tiếng Việt / Telex phổ biến (như 'thấng' -> 'tháng', 'doanh số' -> 'doanh thu', 'tx' -> 'tài xế')
   */
  static cleanTypos(text: string): string {
    return text
      .replace(/thang/g, 'thang')
      .replace(/thấng/g, 'thang')
      .replace(/\btx\b/g, 'tai xe')
      .replace(/\bkh\b/g, 'khach hang')
      .replace(/doanh so/g, 'doanh thu');
  }

  /**
   * Khớp từ khóa an toàn theo ranh giới từ (word boundary)
   */
  static matchKeyword(text: string, kw: string): boolean {
    if (kw.includes(' ')) {
      return text.includes(kw);
    }
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
    return pattern.test(text);
  }

  /**
   * Trích xuất khoảng thời gian linh hoạt từ câu hỏi tiếng Việt
   * Hỗ trợ: Ngày cụ thể, Tháng cụ thể, Quý, Năm, Toàn thời gian, và tương đối
   */
  static extractTimeRange(question: string, defaultDays: number = 7): TimeRangeResult {
    const rawClean = this.cleanTypos(question);
    const norm = this.normalizeText(rawClean);

    const now = new Date(); // Thời điểm hiện tại hệ thống (2026)
    const currentYear = now.getFullYear();

    // 1. Toàn thời gian (All Time)
    if (/(tat ca|toan bo|tu truoc den gio|tong cong|lich su|toan thoi gian)/i.test(norm)) {
      return {
        startDate: null,
        endDate: null,
        label: 'Toàn thời gian (Toàn bộ lịch sử)',
        type: 'ALL_TIME',
      };
    }

    // 2. Ngày cụ thể: DD/MM/YYYY hoặc DD-MM-YYYY
    const dateFull = norm.match(
      new RegExp('(?:ngay\\s*)?(\\b\\d{1,2})[-/](\\d{1,2})[-/](\\d{4})\\b', 'i'),
    );
    if (dateFull) {
      const d = parseInt(dateFull[1], 10);
      const m = parseInt(dateFull[2], 10) - 1;
      const y = parseInt(dateFull[3], 10);
      return {
        startDate: new Date(y, m, d, 0, 0, 0, 0),
        endDate: new Date(y, m, d, 23, 59, 59, 999),
        label: `Ngày ${String(d).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${y}`,
        type: 'SPECIFIC_DATE',
      };
    }

    // 2b. Ngày cụ thể: DD/MM (ngầm định năm hiện tại)
    const dateShort = norm.match(new RegExp('(?:ngay\\s+)(\\d{1,2})[-/](\\d{1,2})\\b', 'i'));
    if (dateShort) {
      const d = parseInt(dateShort[1], 10);
      const m = parseInt(dateShort[2], 10) - 1;
      return {
        startDate: new Date(currentYear, m, d, 0, 0, 0, 0),
        endDate: new Date(currentYear, m, d, 23, 59, 59, 999),
        label: `Ngày ${String(d).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${currentYear}`,
        type: 'SPECIFIC_DATE',
      };
    }

    // 2c. Hôm nay / Hôm qua
    if (/(hom nay|ngay nay)/i.test(norm)) {
      return {
        startDate: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0),
        endDate: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999),
        label: `Hôm nay (${now.toLocaleDateString('vi-VN')})`,
        type: 'SPECIFIC_DATE',
      };
    }
    if (/hom qua/i.test(norm)) {
      const yday = new Date(now);
      yday.setDate(yday.getDate() - 1);
      return {
        startDate: new Date(yday.getFullYear(), yday.getMonth(), yday.getDate(), 0, 0, 0, 0),
        endDate: new Date(yday.getFullYear(), yday.getMonth(), yday.getDate(), 23, 59, 59, 999),
        label: `Hôm qua (${yday.toLocaleDateString('vi-VN')})`,
        type: 'SPECIFIC_DATE',
      };
    }

    // 3. Tháng cụ thể: thang MM/YYYY
    const monthFull = norm.match(new RegExp('(?:thang|thang\\s+)(\\d{1,2})[-/](\\d{4})', 'i'));
    if (monthFull) {
      const m = parseInt(monthFull[1], 10) - 1;
      const y = parseInt(monthFull[2], 10);
      return {
        startDate: new Date(y, m, 1, 0, 0, 0, 0),
        endDate: new Date(y, m + 1, 0, 23, 59, 59, 999),
        label: `Tháng ${m + 1}/${y}`,
        type: 'SPECIFIC_MONTH',
      };
    }

    // 3b. Tháng cụ thể: thang MM (ngầm định năm hiện tại)
    const monthShort = norm.match(/(?:thang\s+)(\d{1,2})\b/i);
    if (monthShort) {
      const m = parseInt(monthShort[1], 10) - 1;
      return {
        startDate: new Date(currentYear, m, 1, 0, 0, 0, 0),
        endDate: new Date(currentYear, m + 1, 0, 23, 59, 59, 999),
        label: `Tháng ${m + 1}/${currentYear}`,
        type: 'SPECIFIC_MONTH',
      };
    }

    // 3c. Tháng này / Tháng trước
    if (/thang nay/i.test(norm)) {
      const m = now.getMonth();
      const y = now.getFullYear();
      return {
        startDate: new Date(y, m, 1, 0, 0, 0, 0),
        endDate: new Date(y, m + 1, 0, 23, 59, 59, 999),
        label: `Tháng này (${m + 1}/${y})`,
        type: 'SPECIFIC_MONTH',
      };
    }
    if (/thang truoc/i.test(norm)) {
      const m = now.getMonth() - 1;
      const y = now.getFullYear();
      return {
        startDate: new Date(y, m, 1, 0, 0, 0, 0),
        endDate: new Date(y, m + 1, 0, 23, 59, 59, 999),
        label: `Tháng trước (${m + 1}/${y})`,
        type: 'SPECIFIC_MONTH',
      };
    }

    // 4. Quý cụ thể: quy [1-4]
    const quarterMatch = norm.match(/(?:quy\s*)([1-4])(?:\s*(?:nam\s*)?(\d{4}))?/i);
    if (quarterMatch) {
      const q = parseInt(quarterMatch[1], 10);
      const y = quarterMatch[2] ? parseInt(quarterMatch[2], 10) : currentYear;
      const sm = (q - 1) * 3;
      const em = sm + 2;
      return {
        startDate: new Date(y, sm, 1, 0, 0, 0, 0),
        endDate: new Date(y, em + 1, 0, 23, 59, 59, 999),
        label: `Quý ${q}/${y}`,
        type: 'SPECIFIC_QUARTER',
      };
    }

    // 5. Năm cụ thể: nam YYYY
    const yearMatch = norm.match(/(?:nam\s*)(\d{4})/i);
    if (yearMatch) {
      const y = parseInt(yearMatch[1], 10);
      return {
        startDate: new Date(y, 0, 1, 0, 0, 0, 0),
        endDate: new Date(y, 11, 31, 23, 59, 59, 999),
        label: `Năm ${y}`,
        type: 'SPECIFIC_YEAR',
      };
    }
    if (/nam nay/i.test(norm)) {
      return {
        startDate: new Date(currentYear, 0, 1, 0, 0, 0, 0),
        endDate: new Date(currentYear, 11, 31, 23, 59, 59, 999),
        label: `Năm ${currentYear}`,
        type: 'SPECIFIC_YEAR',
      };
    }
    if (/nam ngoai/i.test(norm)) {
      const prevYear = currentYear - 1;
      return {
        startDate: new Date(prevYear, 0, 1, 0, 0, 0, 0),
        endDate: new Date(prevYear, 11, 31, 23, 59, 59, 999),
        label: `Năm ${prevYear}`,
        type: 'SPECIFIC_YEAR',
      };
    }

    // 6. Số ngày tương đối
    if (/90 ngay|90d/i.test(norm)) {
      const start = new Date(now);
      start.setDate(start.getDate() - 90);
      return { startDate: start, endDate: now, label: '90 ngày gần nhất', type: 'RELATIVE_DAYS' };
    }
    if (/30 ngay|30d/i.test(norm)) {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return { startDate: start, endDate: now, label: '30 ngày gần nhất', type: 'RELATIVE_DAYS' };
    }
    if (/7 ngay|7d|tuan nay|tuan qua/i.test(norm)) {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return { startDate: start, endDate: now, label: '7 ngày gần nhất', type: 'RELATIVE_DAYS' };
    }

    // 7. Mặc định
    const start = new Date(now);
    start.setDate(start.getDate() - defaultDays);
    return { startDate: start, endDate: now, label: `${defaultDays} ngày qua`, type: 'DEFAULT' };
  }

  /**
   * Phân loại đa ý định (Multi-Intent) + Fuzzy match tiếng Việt
   */
  static classifyIntents(query: string, defaultDays: number = 7): IntentClassificationResult {
    const rawClean = this.cleanTypos(query);
    const normalized = this.normalizeText(rawClean);
    const timeRange = this.extractTimeRange(query, defaultDays);

    const detectedIntents: { intent: AnalystIntent; score: number }[] = [];
    const matchedKeywords: string[] = [];

    // 1. Nhóm Chiến lược tăng trưởng & Đề xuất hành động (ƯU TIÊN CAO NHẤT khi có câu hỏi định hướng)
    const strategyKeywords = [
      'nen lam gi',
      'lam sao',
      'lam the nao',
      'cach tang',
      'tang doanh thu',
      'dinh huong',
      'chien luoc',
      'phat trien',
      'cai thien',
      'giai phap',
      'de xuat',
      'ke hoach',
      'tu van',
      'thang sau nen',
      'thang toi nen',
      'lam gi de',
      'lam sao de',
      'de tang doanh',
      'huong phat trien',
    ];
    let strategyScore = 0;
    for (const kw of strategyKeywords) {
      if (this.matchKeyword(normalized, kw)) {
        strategyScore += 5;
        matchedKeywords.push(kw);
      }
    }
    if (strategyScore > 0) {
      detectedIntents.push({ intent: AnalystIntent.GROWTH_STRATEGY, score: strategyScore + 10 });
    }

    // 2. Nhóm Doanh thu & Tài chính
    const revenueKeywords = [
      'doanh thu',
      'tong doanh thu',
      'tien cuoc',
      'cuoc phi',
      'phi giao hang',
      'phi van chuyen',
      'chiet khau',
      'loi nhuan',
      'thu nhap',
      '15%',
      '85%',
      'tien',
      'tong tien',
      'hoa hong',
      'tai chinh',
      'cuoc van chuyen',
      'tong cuoc',
    ];
    let revenueScore = 0;
    for (const kw of revenueKeywords) {
      if (this.matchKeyword(normalized, kw)) {
        revenueScore += kw.includes(' ') ? 3.5 : 2.0;
        matchedKeywords.push(kw);
      }
    }
    if (revenueScore > 0) {
      detectedIntents.push({ intent: AnalystIntent.REVENUE, score: revenueScore });
    }

    // 3. Nhóm Top Tài xế
    const driverKeywords = [
      'tai xe',
      'shipper',
      'bac tai',
      'ai giao nhieu nhat',
      'ai chay nhieu nhat',
      'top tai xe',
      'doanh thu cao nhat',
      'thu nhap tai xe',
      'lai xe',
      'bien so',
      'giao xuat sac',
      'tai xe gioi',
      'chiet khau tai xe',
      'tai xe nao',
      'doi xe',
    ];
    let driverScore = 0;
    for (const kw of driverKeywords) {
      if (this.matchKeyword(normalized, kw)) {
        driverScore += kw.includes(' ') ? 3.5 : 2.0;
        matchedKeywords.push(kw);
      }
    }
    if (driverScore > 0) {
      detectedIntents.push({ intent: AnalystIntent.TOP_DRIVERS, score: driverScore });
    }

    // 4. Nhóm Top Khách hàng
    const customerKeywords = [
      'khach hang',
      'nguoi mua',
      'ai mua nhieu nhat',
      'ai dat nhieu nhat',
      'top khach hang',
      'khach vip',
      'khach quen',
      'sdt',
      'so dien thoai',
      'dia chi khach',
      'khach hang than thiet',
      'khach nao',
    ];
    let customerScore = 0;
    for (const kw of customerKeywords) {
      if (this.matchKeyword(normalized, kw)) {
        customerScore += kw.includes(' ') ? 3.5 : 2.0;
        matchedKeywords.push(kw);
      }
    }
    if (customerScore > 0) {
      detectedIntents.push({ intent: AnalystIntent.TOP_CUSTOMERS, score: customerScore });
    }

    // 5. Nhóm Dự báo & Xu hướng
    const forecastKeywords = [
      'du bao',
      'xu huong',
      'tuan toi',
      'thang toi',
      'ngay mai',
      'tuong lai',
      'tang hay giam',
      'hoi quy',
      'linear regression',
      'du doan',
      'du kien',
      'tang truong',
      'suy giam',
      'ky toi',
      'sap toi',
    ];
    let forecastScore = 0;
    for (const kw of forecastKeywords) {
      if (this.matchKeyword(normalized, kw)) {
        forecastScore += kw.includes(' ') ? 3.5 : 2.0;
        matchedKeywords.push(kw);
      }
    }
    if (forecastScore > 0) {
      detectedIntents.push({ intent: AnalystIntent.FORECAST, score: forecastScore });
    }

    // 6. Nhóm Ngày đỉnh tải / Cao điểm
    const peakKeywords = [
      'cao diem',
      'qua tai',
      'dinh tai',
      'peak',
      'ngay nao dong nhat',
      'ngay nao nhieu don nhat',
      'ngay nao ban nhat',
      'z score',
      'z-score',
      'tac nghen',
      'don don',
      'canh bao qua tai',
    ];
    let peakScore = 0;
    for (const kw of peakKeywords) {
      if (this.matchKeyword(normalized, kw)) {
        peakScore += kw.includes(' ') ? 3.5 : 2.0;
        matchedKeywords.push(kw);
      }
    }
    if (peakScore > 0) {
      detectedIntents.push({ intent: AnalystIntent.PEAK_DAY, score: peakScore });
    }

    // 7. Nhóm Vận hành, KPI, COD
    const opKeywords = [
      'ty le thanh cong',
      'giao hang thanh cong',
      'giao thanh cong',
      'don that bai',
      'that bai',
      'doi soat',
      'cod',
      'tien thu ho',
      'ca lam viec',
      'van hanh',
      'dieu phoi',
      'tong don',
      'don hang',
      'hieu suat',
      'sla',
      'so don',
      'ty le',
    ];
    let opScore = 0;
    for (const kw of opKeywords) {
      if (this.matchKeyword(normalized, kw)) {
        opScore += kw.includes(' ') ? 3.5 : 2.0;
        matchedKeywords.push(kw);
      }
    }
    if (opScore > 0) {
      detectedIntents.push({ intent: AnalystIntent.OPERATIONS, score: opScore });
    }

    // 8. Chào hỏi
    if (detectedIntents.length === 0) {
      if (
        /(^|\s)(chao|xin chao|hello|hi|alo|hey|ban la ai|tro ly|giup gi|huong dan)($|\s|[.,?!])/i.test(
          normalized,
        )
      ) {
        detectedIntents.push({ intent: AnalystIntent.GREETING, score: 3 });
        matchedKeywords.push('chao');
      }
    }

    // Sắp xếp các ý định theo điểm số giảm dần
    detectedIntents.sort((a, b) => b.score - a.score);

    const primaryIntent =
      detectedIntents.length > 0 ? detectedIntents[0].intent : AnalystIntent.UNKNOWN;
    const intents = detectedIntents.map((i) => i.intent);
    const confidence =
      detectedIntents.length > 0
        ? Math.min(0.99, Number((detectedIntents[0].score / 10 + 0.45).toFixed(2)))
        : 0;

    return {
      primaryIntent,
      intents,
      confidence,
      matchedKeywords,
      normalizedQuery: normalized,
      timeRange,
    };
  }
}
