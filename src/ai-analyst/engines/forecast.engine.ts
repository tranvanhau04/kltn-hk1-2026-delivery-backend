export interface DataPoint {
  x: number;
  y: number;
  label: string;
}

export interface LinearRegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  trend: 'UP' | 'DOWN' | 'STABLE';
  growthRatePercent: number;
  historicalAvg: number;
  predictedNext: number;
  nextPoints: { label: string; predicted: number }[];
}

export interface ZScoreItem {
  label: string;
  value: number;
  zScore: number;
  isPeak: boolean;
}

export interface PeakDayResult {
  peakDay: string;
  peakValue: number;
  zScore: number;
  isAbnormal: boolean;
  mean: number;
  stdDev: number;
  details: ZScoreItem[];
  alertMessage: string;
}

export class ForecastEngine {
  /**
   * Tính toán hồi quy tuyến tính (Ordinary Least Squares Linear Regression)
   * y = mx + b
   */
  static calculateLinearRegression(points: DataPoint[]): LinearRegressionResult {
    const n = points.length;
    if (n === 0) {
      return {
        slope: 0,
        intercept: 0,
        rSquared: 0,
        trend: 'STABLE',
        growthRatePercent: 0,
        historicalAvg: 0,
        predictedNext: 0,
        nextPoints: [],
      };
    }

    if (n === 1) {
      return {
        slope: 0,
        intercept: points[0].y,
        rSquared: 1,
        trend: 'STABLE',
        growthRatePercent: 0,
        historicalAvg: points[0].y,
        predictedNext: points[0].y,
        nextPoints: [{ label: 'Kỳ tiếp theo', predicted: points[0].y }],
      };
    }

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (let i = 0; i < n; i++) {
      const { x, y } = points[i];
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }

    const meanY = sumY / n;
    const denominator = n * sumXX - sumX * sumX;
    const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    // R-squared (hệ số xác định)
    let ssTot = 0;
    let ssRes = 0;
    for (let i = 0; i < n; i++) {
      const { x, y } = points[i];
      const yPred = slope * x + intercept;
      ssTot += Math.pow(y - meanY, 2);
      ssRes += Math.pow(y - yPred, 2);
    }

    const rSquared = ssTot === 0 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

    // Dự báo kỳ kế tiếp (x = n)
    const predictedNext = Math.max(0, Math.round(slope * n + intercept));
    const growthRatePercent =
      meanY > 0 ? Number((((predictedNext - meanY) / meanY) * 100).toFixed(1)) : 0;

    let trend: 'UP' | 'DOWN' | 'STABLE' = 'STABLE';
    if (growthRatePercent >= 3) {
      trend = 'UP';
    } else if (growthRatePercent <= -3) {
      trend = 'DOWN';
    }

    // Dự báo 3 điểm tiếp theo
    const nextPoints = [1, 2, 3].map((step) => {
      const futureX = n - 1 + step;
      const pred = Math.max(0, Math.round(slope * futureX + intercept));
      return {
        label: `Kỳ +${step}`,
        predicted: pred,
      };
    });

    return {
      slope: Number(slope.toFixed(2)),
      intercept: Number(intercept.toFixed(2)),
      rSquared: Number((rSquared * 100).toFixed(1)),
      trend,
      growthRatePercent,
      historicalAvg: Math.round(meanY),
      predictedNext,
      nextPoints,
    };
  }

  /**
   * Phát hiện ngày đỉnh tải (Peak Day) bằng phương pháp Z-Score
   * z = (x - mean) / stdDev
   */
  static detectPeakDay(items: { label: string; value: number }[]): PeakDayResult {
    const n = items.length;
    if (n === 0) {
      return {
        peakDay: 'Không có dữ liệu',
        peakValue: 0,
        zScore: 0,
        isAbnormal: false,
        mean: 0,
        stdDev: 0,
        details: [],
        alertMessage: 'Chưa có đủ dữ liệu để phân tích đỉnh tải',
      };
    }

    const values = items.map((i) => i.value);
    const mean = values.reduce((acc, v) => acc + v, 0) / n;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    let maxZ = -Infinity;
    let peakIndex = 0;

    const details: ZScoreItem[] = items.map((item, idx) => {
      const z = stdDev > 0 ? (item.value - mean) / stdDev : 0;
      if (z > maxZ) {
        maxZ = z;
        peakIndex = idx;
      }
      return {
        label: item.label,
        value: item.value,
        zScore: Number(z.toFixed(2)),
        isPeak: false,
      };
    });

    if (details[peakIndex]) {
      details[peakIndex].isPeak = true;
    }

    const peakItem = items[peakIndex] || { label: 'N/A', value: 0 };
    const isAbnormal = maxZ >= 1.25 && peakItem.value > 0;

    let alertMessage = `Ngày ${peakItem.label} có lượng vận hành cao nhất (${peakItem.value.toLocaleString('vi-VN')}), dao động ở ngưỡng bình thường.`;
    if (isAbnormal) {
      const percentOverMean = mean > 0 ? Math.round(((peakItem.value - mean) / mean) * 100) : 0;
      alertMessage = `CẢNH BÁO CAO ĐIỂM: Ngày ${peakItem.label} có lượng đơn tăng đột biến (+${percentOverMean}% so với trung bình), Z-Score = ${maxZ.toFixed(2)}. Cần chuẩn bị thêm tài xế dự phòng.`;
    }

    return {
      peakDay: peakItem.label,
      peakValue: peakItem.value,
      zScore: Number(maxZ.toFixed(2)),
      isAbnormal,
      mean: Math.round(mean),
      stdDev: Math.round(stdDev),
      details,
      alertMessage,
    };
  }
}
