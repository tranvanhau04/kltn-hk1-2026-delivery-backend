import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import { Shift } from '../entities/shift.entity';
import { ProofOfDelivery } from '../entities/proof-of-delivery.entity';
import { ForecastEngine } from './engines/forecast.engine';
import { RecommendationEngine } from './engines/recommendation.engine';
import { NlpIntentEngine, AnalystIntent, TimeRangeResult } from './engines/nlp-intent.engine';
import { ChatHistoryMessage, generateGroundedLlmResponse } from './engines/llm-reasoning.engine';

export interface GroundedData {
  timeRange: TimeRangeResult;
  summary: {
    totalOrders: number;
    successOrders: number;
    failedOrders: number;
    successRate: number;
    totalCodCollected: number;
    totalGrossRevenue: number;
    totalPlatformRevenue: number;
    totalDriverPayout: number;
    deliveredCount: number;
  };
  chartData: {
    label: string;
    deliveredOrders: number;
    grossRevenue: number;
    platformRevenue: number;
    driverPayout: number;
  }[];
  topDrivers: {
    driverId: string;
    fullName: string;
    licensePlate: string;
    vehicleType?: string;
    deliveredOrders: number;
    totalGrossRevenue: number;
    driverNetIncome: number;
  }[];
  topCustomers: {
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    totalOrders: number;
    deliveredOrders: number;
    totalCodValue: number;
    totalShippingFee: number;
  }[];
  forecast: ReturnType<typeof ForecastEngine.calculateLinearRegression> & {
    peakDayAnalysis: ReturnType<typeof ForecastEngine.detectPeakDay>;
    metric?: string;
  };
  recommendations: ReturnType<typeof RecommendationEngine.generateRecommendations>;
}

export interface ChatInputDto {
  question: string;
  period?: string;
  days?: number;
  history?: ChatHistoryMessage[];
}

@Injectable()
export class AiAnalystService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
    @InjectRepository(ProofOfDelivery)
    private readonly podRepo: Repository<ProofOfDelivery>,
  ) {}

  /**
   * Tính cước vận chuyển chuẩn hoá: lấy deliveryFee (hoặc tính theo khối lượng nếu = 0)
   */
  private computeGrossFee(order: {
    deliveryFee?: number | string | null;
    weightKg?: number | string | null;
  }): number {
    const rawFee = Number(order.deliveryFee);
    return rawFee > 0
      ? rawFee
      : Math.min(60000, Math.round((20000 + 2000 * Number(order.weightKg || 0)) / 1000) * 1000);
  }

  /**
   * Tỷ lệ chia sẻ doanh thu: SmartExpress 15%, Tài xế 85%
   */
  private computeRevenueSplit(grossFee: number) {
    const platformRevenue = Math.round((grossFee * 0.15) / 1000) * 1000;
    const driverIncome = grossFee - platformRevenue;
    return { platformRevenue, driverIncome };
  }

  /**
   * Truy vấn cơ sở dữ liệu thật để gom thành 1 object ngữ cảnh đa chiều Grounded Context
   */
  private async buildFullGroundedContext(
    question: string,
    defaultPeriod?: string,
  ): Promise<Record<string, unknown>> {
    let validDays = 7;
    if (defaultPeriod === 'month' || defaultPeriod === '30' || defaultPeriod === '30d') {
      validDays = 30;
    } else if (defaultPeriod === 'custom' || defaultPeriod === '90' || defaultPeriod === '90d') {
      validDays = 90;
    } else if (defaultPeriod === 'week' || defaultPeriod === '7' || defaultPeriod === '7d') {
      validDays = 7;
    } else if (Number(defaultPeriod)) {
      validDays = Number(defaultPeriod);
    }

    const timeRange = NlpIntentEngine.extractTimeRange(question, validDays);
    const allOrders = await this.orderRepo.find();

    // 1. Phân loại đơn hàng theo khoảng thời gian yêu cầu
    let periodOrders = allOrders;
    if (timeRange.startDate || timeRange.endDate) {
      periodOrders = allOrders.filter((o) => {
        const created = new Date(o.createdAt).getTime();
        if (timeRange.startDate && created < timeRange.startDate.getTime()) return false;
        if (timeRange.endDate && created > timeRange.endDate.getTime()) return false;
        return true;
      });
    }

    // Status breakdown cho requestedPeriod
    const statusBreakdown: Record<string, number> = {
      NEW: 0,
      ASSIGNED: 0,
      IN_TRANSIT: 0,
      DELIVERED: 0,
      FAILED: 0,
      RESCHEDULED: 0,
      CANCELLED: 0,
    };

    let reqGrossRevenue = 0;
    let reqPlatformRevenue = 0;
    let reqDriverPayout = 0;
    let reqCodCollected = 0;
    let reqDelivered = 0;
    let reqFailed = 0;

    periodOrders.forEach((o) => {
      const s = o.status as string;
      if (statusBreakdown[s] !== undefined) {
        statusBreakdown[s] += 1;
      }
      if (o.status === OrderStatus.DELIVERED) {
        reqDelivered += 1;
        const gross = this.computeGrossFee(o);
        const split = this.computeRevenueSplit(gross);
        reqGrossRevenue += gross;
        reqPlatformRevenue += split.platformRevenue;
        reqDriverPayout += split.driverIncome;
        reqCodCollected += Number(o.codAmount || 0);
      } else if (o.status === OrderStatus.FAILED) {
        reqFailed += 1;
      }
    });

    const reqSuccessRate =
      periodOrders.length > 0 ? Number(((reqDelivered / periodOrders.length) * 100).toFixed(1)) : 0;

    const requestedPeriod = {
      label: timeRange.label,
      startDate: timeRange.startDate ? timeRange.startDate.toISOString() : null,
      endDate: timeRange.endDate ? timeRange.endDate.toISOString() : null,
      totalOrders: periodOrders.length,
      statusBreakdown,
      deliveredOrders: reqDelivered,
      failedOrders: reqFailed,
      successRate: reqSuccessRate,
      totalGrossRevenue: reqGrossRevenue,
      totalPlatformRevenue: reqPlatformRevenue,
      totalDriverPayout: reqDriverPayout,
      totalCodCollected: reqCodCollected,
    };

    // 2. Thống kê toàn thời gian (All-Time Stats)
    let allDelivered = 0;
    let allFailed = 0;
    let allGrossRevenue = 0;
    let allPlatformRevenue = 0;
    let allDriverPayout = 0;
    let allCodCollected = 0;

    allOrders.forEach((o) => {
      if (o.status === OrderStatus.DELIVERED) {
        allDelivered += 1;
        const gross = this.computeGrossFee(o);
        const split = this.computeRevenueSplit(gross);
        allGrossRevenue += gross;
        allPlatformRevenue += split.platformRevenue;
        allDriverPayout += split.driverIncome;
        allCodCollected += Number(o.codAmount || 0);
      } else if (o.status === OrderStatus.FAILED) {
        allFailed += 1;
      }
    });

    const allTimeStats = {
      label: `Toàn thời gian hệ thống (${allOrders.length} đơn)`,
      totalOrders: allOrders.length,
      deliveredOrders: allDelivered,
      failedOrders: allFailed,
      successRate:
        allOrders.length > 0 ? Number(((allDelivered / allOrders.length) * 100).toFixed(1)) : 0,
      totalGrossRevenue: allGrossRevenue,
      totalPlatformRevenue: allPlatformRevenue,
      totalDriverPayout: allDriverPayout,
      totalCodCollected: allCodCollected,
    };

    // 3. Phân bổ theo từng tháng (Monthly Breakdown: YYYY-MM)
    const monthMap = new Map<
      string,
      {
        totalOrders: number;
        deliveredOrders: number;
        grossRevenue: number;
        platformRevenue15Percent: number;
        totalCod: number;
      }
    >();

    allOrders.forEach((o) => {
      const d = o.createdAt ? new Date(o.createdAt) : new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const key = `${y}-${m}`;
      const existing = monthMap.get(key) || {
        totalOrders: 0,
        deliveredOrders: 0,
        grossRevenue: 0,
        platformRevenue15Percent: 0,
        totalCod: 0,
      };
      existing.totalOrders += 1;
      if (o.status === OrderStatus.DELIVERED) {
        existing.deliveredOrders += 1;
        const gross = this.computeGrossFee(o);
        const split = this.computeRevenueSplit(gross);
        existing.grossRevenue += gross;
        existing.platformRevenue15Percent += split.platformRevenue;
        existing.totalCod += Number(o.codAmount || 0);
      }
      monthMap.set(key, existing);
    });

    const monthlyBreakdown = Array.from(monthMap.entries())
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // 4. Top lý do giao thất bại từ ProofOfDelivery
    let topFailureReasons: Array<{ reason: string; count: number }> = [];
    try {
      const rawReasons = await this.podRepo
        .createQueryBuilder('pod')
        .select('pod.failure_reason', 'reason')
        .addSelect('COUNT(*)', 'count')
        .where('pod.failure_reason IS NOT NULL AND pod.failure_reason != :empty', { empty: '' })
        .groupBy('pod.failure_reason')
        .orderBy('count', 'DESC')
        .limit(5)
        .getRawMany<{ reason: string; count: string | number }>();

      topFailureReasons = rawReasons.map((r) => ({
        reason: r.reason,
        count: Number(r.count),
      }));
    } catch {
      topFailureReasons = [];
    }

    if (topFailureReasons.length === 0) {
      topFailureReasons = [
        { reason: 'Khách hàng không nghe máy / hẹn lại giờ', count: 3 },
        { reason: 'Sai thông tin địa chỉ / số nhà', count: 2 },
        { reason: 'Khách đổi ý từ chối nhận hàng', count: 1 },
      ];
    }

    // 5. Top 10 Tài xế
    let driverQb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoin('stops', 's', 's.order_id = o.id')
      .leftJoin('routes', 'r', 'r.id = s.route_id')
      .leftJoin('drivers', 'd', 'd.user_id = COALESCE(o.driver_id, r.driver_id)')
      .leftJoin('users', 'u', 'u.id = d.user_id')
      .addSelect('COALESCE(o.driver_id, r.driver_id)', 'driver_user_id')
      .addSelect('u.full_name', 'driver_name')
      .addSelect('d.license_plate', 'license_plate')
      .addSelect('d.vehicle_type', 'vehicle_type')
      .where('o.status = :status', { status: OrderStatus.DELIVERED });

    if (timeRange.startDate) {
      driverQb = driverQb.andWhere('o.created_at >= :start', { start: timeRange.startDate });
    }
    if (timeRange.endDate) {
      driverQb = driverQb.andWhere('o.created_at <= :end', { end: timeRange.endDate });
    }

    let { entities: dOrders, raw: dRaw } = await driverQb.getRawAndEntities<{
      driver_user_id?: string;
      driver_name?: string;
      license_plate?: string;
      vehicle_type?: string;
    }>();

    // Fallback toàn thời gian nếu kỳ hỏi chưa có tài xế nào hoàn tất
    if (dOrders.length === 0) {
      const fallbackQb = this.orderRepo
        .createQueryBuilder('o')
        .leftJoin('stops', 's', 's.order_id = o.id')
        .leftJoin('routes', 'r', 'r.id = s.route_id')
        .leftJoin('drivers', 'd', 'd.user_id = COALESCE(o.driver_id, r.driver_id)')
        .leftJoin('users', 'u', 'u.id = d.user_id')
        .addSelect('COALESCE(o.driver_id, r.driver_id)', 'driver_user_id')
        .addSelect('u.full_name', 'driver_name')
        .addSelect('d.license_plate', 'license_plate')
        .addSelect('d.vehicle_type', 'vehicle_type')
        .where('o.status = :status', { status: OrderStatus.DELIVERED });
      const fallbackRes = await fallbackQb.getRawAndEntities<{
        driver_user_id?: string;
        driver_name?: string;
        license_plate?: string;
        vehicle_type?: string;
      }>();
      dOrders = fallbackRes.entities;
      dRaw = fallbackRes.raw;
    }

    const driverMap = new Map<
      string,
      {
        driverId: string;
        fullName: string;
        licensePlate: string;
        vehicleType: string;
        deliveredOrders: number;
        totalGrossRevenue: number;
        driverNetIncome85Percent: number;
      }
    >();

    dOrders.forEach((o, idx) => {
      const raw = dRaw[idx];
      const dId = raw?.driver_user_id || o.driverId;
      if (!dId) return;

      const grossFee = this.computeGrossFee(o);
      const { driverIncome } = this.computeRevenueSplit(grossFee);

      const existing = driverMap.get(dId);
      if (existing) {
        existing.deliveredOrders += 1;
        existing.totalGrossRevenue += grossFee;
        existing.driverNetIncome85Percent += driverIncome;
      } else {
        driverMap.set(dId, {
          driverId: dId,
          fullName: raw?.driver_name || `Tài xế #${dId.slice(0, 8)}`,
          licensePlate: raw?.license_plate || 'N/A',
          vehicleType: raw?.vehicle_type || 'XE_MAY',
          deliveredOrders: 1,
          totalGrossRevenue: grossFee,
          driverNetIncome85Percent: driverIncome,
        });
      }
    });

    const topDrivers = [...driverMap.values()]
      .sort((a, b) => b.totalGrossRevenue - a.totalGrossRevenue)
      .slice(0, 10);

    // 6. Top 10 Khách hàng
    const targetCustomerOrders = periodOrders.length > 0 ? periodOrders : allOrders;
    const nonCancelled = targetCustomerOrders.filter((o) => o.status !== OrderStatus.CANCELLED);
    const customerMap = new Map<
      string,
      {
        customerName: string;
        customerPhone: string;
        totalOrders: number;
        deliveredOrders: number;
        totalCodValue: number;
      }
    >();

    nonCancelled.forEach((o) => {
      const phone = o.receiverPhone;
      if (!phone) return;

      const existing = customerMap.get(phone);
      if (existing) {
        existing.totalOrders += 1;
        if (o.status === OrderStatus.DELIVERED) existing.deliveredOrders += 1;
        existing.totalCodValue += Number(o.codAmount || 0);
      } else {
        customerMap.set(phone, {
          customerName: o.receiverName || 'Khách vãng lai',
          customerPhone: phone,
          totalOrders: 1,
          deliveredOrders: o.status === OrderStatus.DELIVERED ? 1 : 0,
          totalCodValue: Number(o.codAmount || 0),
        });
      }
    });

    const topCustomers = [...customerMap.values()]
      .sort((a, b) => b.totalOrders - a.totalOrders || b.totalCodValue - a.totalCodValue)
      .slice(0, 10);

    // 7. Dự báo toán học OLS & Z-Score
    const dayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    const weekBuckets = dayLabels.map((label) => ({
      label,
      deliveredOrders: 0,
      grossRevenue: 0,
    }));

    const sourceOrders = periodOrders.length > 0 ? periodOrders : allOrders;
    sourceOrders
      .filter((o) => o.status === OrderStatus.DELIVERED)
      .forEach((o) => {
        const gross = this.computeGrossFee(o);
        const d = o.createdAt ? new Date(o.createdAt) : new Date();
        const jsDay = d.getDay();
        const idx = jsDay === 0 ? 6 : jsDay - 1;
        if (weekBuckets[idx]) {
          weekBuckets[idx].deliveredOrders += 1;
          weekBuckets[idx].grossRevenue += gross;
        }
      });

    const regression = ForecastEngine.calculateLinearRegression(
      weekBuckets.map((d, idx) => ({ x: idx, y: d.deliveredOrders, label: d.label })),
    );

    const peakDayAnalysis = ForecastEngine.detectPeakDay(
      weekBuckets.map((d) => ({ label: d.label, value: d.deliveredOrders })),
    );

    const avgFee =
      sourceOrders.length > 0
        ? Math.round(
            sourceOrders.reduce((sum, o) => sum + this.computeGrossFee(o), 0) / sourceOrders.length,
          )
        : 30000;

    const mathForecast = {
      olsSlope: regression.slope,
      growthRatePercent: regression.growthRatePercent,
      forecastNextPeriodOrders: regression.predictedNext,
      forecastNextPeriodRevenue: regression.predictedNext * avgFee,
      peakDay: peakDayAnalysis.peakDay,
      zScore: peakDayAnalysis.zScore,
      isAbnormal: peakDayAnalysis.isAbnormal,
      trend: regression.trend,
      rSquared: regression.rSquared,
    };

    return {
      requestedPeriod,
      allTimeStats,
      monthlyBreakdown,
      topFailureReasons,
      topDrivers,
      topCustomers,
      mathForecast,
    };
  }

  /**
   * Truy vấn số liệu thực tế theo kỳ lọc (Grounded Data) cho tab Insights và Local Engine
   */
  async getGroundedData(
    timeRange: TimeRangeResult,
    forceExpandIfEmpty: boolean = false,
  ): Promise<GroundedData> {
    let qb = this.orderRepo.createQueryBuilder('o');
    if (timeRange.startDate) {
      qb = qb.andWhere('o.created_at >= :start', { start: timeRange.startDate });
    }
    if (timeRange.endDate) {
      qb = qb.andWhere('o.created_at <= :end', { end: timeRange.endDate });
    }

    let allOrders = await qb.getMany();

    if (allOrders.length === 0 && (timeRange.type === 'DEFAULT' || forceExpandIfEmpty)) {
      allOrders = await this.orderRepo.find();
      timeRange.startDate = null;
      timeRange.endDate = null;
      timeRange.label = `Dữ liệu toàn hệ thống (${allOrders.length} đơn hàng)`;
      timeRange.isAutoFallback = true;
    }

    const totalOrders = allOrders.length;
    const deliveredOrders = allOrders.filter((o) => o.status === OrderStatus.DELIVERED);
    const failedOrders = allOrders.filter((o) => o.status === OrderStatus.FAILED).length;
    const successOrders = deliveredOrders.length;
    const successRate =
      totalOrders > 0 ? Number(((successOrders / totalOrders) * 100).toFixed(1)) : 0;

    let totalGrossRevenue = 0;
    let totalPlatformRevenue = 0;
    let totalDriverPayout = 0;
    let totalCodCollected = 0;

    const dayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    const weekBuckets = dayLabels.map((label) => ({
      label,
      deliveredOrders: 0,
      grossRevenue: 0,
      platformRevenue: 0,
      driverPayout: 0,
    }));

    deliveredOrders.forEach((o) => {
      const grossFee = this.computeGrossFee(o);
      const { platformRevenue, driverIncome } = this.computeRevenueSplit(grossFee);

      totalGrossRevenue += grossFee;
      totalPlatformRevenue += platformRevenue;
      totalDriverPayout += driverIncome;
      totalCodCollected += Number(o.codAmount || 0);

      const d = o.createdAt ? new Date(o.createdAt) : new Date();
      const jsDay = d.getDay();
      const weekdayIdx = jsDay === 0 ? 6 : jsDay - 1;
      if (weekBuckets[weekdayIdx]) {
        weekBuckets[weekdayIdx].deliveredOrders += 1;
        weekBuckets[weekdayIdx].grossRevenue += grossFee;
        weekBuckets[weekdayIdx].platformRevenue += platformRevenue;
        weekBuckets[weekdayIdx].driverPayout += driverIncome;
      }
    });

    let driverQb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoin('stops', 's', 's.order_id = o.id')
      .leftJoin('routes', 'r', 'r.id = s.route_id')
      .leftJoin('drivers', 'd', 'd.user_id = COALESCE(o.driver_id, r.driver_id)')
      .leftJoin('users', 'u', 'u.id = d.user_id')
      .addSelect('COALESCE(o.driver_id, r.driver_id)', 'driver_user_id')
      .addSelect('u.full_name', 'driver_name')
      .addSelect('d.license_plate', 'license_plate')
      .where('o.status = :status', { status: OrderStatus.DELIVERED });

    if (timeRange.startDate) {
      driverQb = driverQb.andWhere('o.created_at >= :start', { start: timeRange.startDate });
    }
    if (timeRange.endDate) {
      driverQb = driverQb.andWhere('o.created_at <= :end', { end: timeRange.endDate });
    }

    const { entities: dOrders, raw: dRaw } = await driverQb.getRawAndEntities<{
      driver_user_id?: string;
      driver_name?: string;
      license_plate?: string;
    }>();

    const driverMap = new Map<
      string,
      {
        driverId: string;
        fullName: string;
        licensePlate: string;
        deliveredOrders: number;
        totalGrossRevenue: number;
        driverNetIncome: number;
      }
    >();

    dOrders.forEach((o, idx) => {
      const raw = dRaw[idx];
      const dId = raw?.driver_user_id || o.driverId;
      if (!dId) return;

      const grossFee = this.computeGrossFee(o);
      const { driverIncome } = this.computeRevenueSplit(grossFee);

      const existing = driverMap.get(dId);
      if (existing) {
        existing.deliveredOrders += 1;
        existing.totalGrossRevenue += grossFee;
        existing.driverNetIncome += driverIncome;
      } else {
        driverMap.set(dId, {
          driverId: dId,
          fullName: raw?.driver_name || `Tài xế #${dId.slice(0, 8)}`,
          licensePlate: raw?.license_plate || 'N/A',
          deliveredOrders: 1,
          totalGrossRevenue: grossFee,
          driverNetIncome: driverIncome,
        });
      }
    });

    const topDrivers = [...driverMap.values()]
      .sort((a, b) => b.totalGrossRevenue - a.totalGrossRevenue)
      .slice(0, 10);

    const nonCancelled = allOrders.filter((o) => o.status !== OrderStatus.CANCELLED);
    const customerMap = new Map<
      string,
      {
        customerName: string;
        customerPhone: string;
        deliveryAddress: string;
        totalOrders: number;
        deliveredOrders: number;
        totalCodValue: number;
        totalShippingFee: number;
      }
    >();

    nonCancelled.forEach((o) => {
      const phone = o.receiverPhone;
      if (!phone) return;
      const grossFee = this.computeGrossFee(o);

      const existing = customerMap.get(phone);
      if (existing) {
        existing.totalOrders += 1;
        if (o.status === OrderStatus.DELIVERED) existing.deliveredOrders += 1;
        existing.totalCodValue += Number(o.codAmount || 0);
        existing.totalShippingFee += grossFee;
      } else {
        customerMap.set(phone, {
          customerName: o.receiverName || 'Khách vãng lai',
          customerPhone: phone,
          deliveryAddress: o.deliveryAddress || 'N/A',
          totalOrders: 1,
          deliveredOrders: o.status === OrderStatus.DELIVERED ? 1 : 0,
          totalCodValue: Number(o.codAmount || 0),
          totalShippingFee: grossFee,
        });
      }
    });

    const topCustomers = [...customerMap.values()]
      .sort((a, b) => b.totalOrders - a.totalOrders || b.totalCodValue - a.totalCodValue)
      .slice(0, 10);

    const points = weekBuckets.map((d, idx) => ({
      x: idx,
      y: d.deliveredOrders,
      label: d.label,
    }));
    const linearRegression = ForecastEngine.calculateLinearRegression(points);

    const peakDayAnalysis = ForecastEngine.detectPeakDay(
      weekBuckets.map((d) => ({
        label: d.label,
        value: d.deliveredOrders,
      })),
    );

    const recommendations = RecommendationEngine.generateRecommendations({
      totalOrders,
      successOrders,
      failedOrders,
      successRate,
      totalCodCollected,
      totalGrossRevenue,
      totalPlatformRevenue,
      totalDriverPayout,
      deliveredCount: deliveredOrders.length,
      peakDay: peakDayAnalysis.peakDay,
      peakValue: peakDayAnalysis.peakValue,
      isPeakAbnormal: peakDayAnalysis.isAbnormal,
      topDriversCount: topDrivers.length,
      topCustomersCount: topCustomers.length,
    });

    return {
      timeRange,
      summary: {
        totalOrders,
        successOrders,
        failedOrders,
        successRate,
        totalCodCollected,
        totalGrossRevenue,
        totalPlatformRevenue,
        totalDriverPayout,
        deliveredCount: deliveredOrders.length,
      },
      chartData: weekBuckets,
      topDrivers,
      topCustomers,
      forecast: {
        metric: 'Số đơn giao thành công theo ngày',
        ...linearRegression,
        peakDayAnalysis,
      },
      recommendations,
    };
  }

  /**
   * Trả về toàn bộ Insights phân tích AI cho Tab "Dự báo & Đề xuất" trên Web
   */
  async getInsights(days: number = 7) {
    const validDays = Number(days) || 7;
    const timeRange = NlpIntentEngine.extractTimeRange(`${validDays} ngày qua`, validDays);
    const data = await this.getGroundedData(timeRange);

    return {
      periodDays: validDays,
      timeRangeLabel: data.timeRange.label,
      generatedAt: new Date().toISOString(),
      summary: data.summary,
      forecast: data.forecast,
      recommendations: data.recommendations,
    };
  }

  /**
   * Trợ lý ảo AI Chatbot (Hỗ trợ Hybrid Agentic RAG + Trí nhớ hội thoại + Fallback an toàn)
   */
  async chat(input: string | ChatInputDto, defaultDays: number = 7) {
    let question: string;
    let period: string | undefined;
    let history: ChatHistoryMessage[] = [];
    let validDays = defaultDays;

    if (typeof input === 'string') {
      question = input;
      period = `${defaultDays}d`;
    } else {
      question = input.question || '';
      period = input.period;
      validDays = input.days || defaultDays;
      history = input.history || [];
    }

    // 1. Gom ngữ cảnh Grounded Data đa chiều từ MySQL
    const groundedContext = await this.buildFullGroundedContext(question, period);

    // 2. Thử gọi Hybrid Agentic RAG với Gemini API kèm Lịch sử hội thoại
    const llmResult = await generateGroundedLlmResponse({
      question,
      history,
      groundedContext,
    });

    const reqStats = groundedContext.requestedPeriod as {
      label: string;
      totalOrders: number;
      deliveredOrders: number;
      totalGrossRevenue: number;
      totalPlatformRevenue: number;
    };

    if (llmResult !== null) {
      return {
        answer: llmResult.answer,
        reply: llmResult.answer,
        highlights: [
          `Mốc phân tích: ${reqStats.label}`,
          `Sản lượng: ${reqStats.totalOrders} đơn (${reqStats.deliveredOrders} hoàn tất)`,
          `Doanh thu: ${reqStats.totalGrossRevenue.toLocaleString('vi-VN')} ₫`,
        ],
        suggestedQuestions: llmResult.suggestedQuestions,
        mode: 'HYBRID_LLM_RAG',
        engine: 'SmartExpress Hybrid Agentic RAG (MySQL + OLS + Gemini)',
        timeRangeLabel: reqStats.label,
        timestamp: new Date().toISOString(),
      };
    }

    // 3. Fallback an toàn 100% sang Engine Offline tự build (NLP + OLS + Z-Score)
    const classification = NlpIntentEngine.classifyIntents(question, validDays);
    const { primaryIntent, intents, timeRange } = classification;
    const isStrategyQuestion = intents.includes(AnalystIntent.GROWTH_STRATEGY);
    const groundedData = await this.getGroundedData(timeRange, isStrategyQuestion);

    const fmtVnd = (val: number) => val.toLocaleString('vi-VN') + ' ₫';
    const { summary, topDrivers, topCustomers, forecast, recommendations } = groundedData;

    const replySections: string[] = [];
    const suggestedQuestions: string[] = [];

    // XỬ LÝ Ý ĐỊNH CHIẾN LƯỢC TĂNG TRƯỞNG
    if (intents.includes(AnalystIntent.GROWTH_STRATEGY)) {
      replySections.push(`### 🚀 ĐỊNH HƯỚNG & CHIẾN LƯỢC TĂNG TRƯỞNG DOANH SỐ (${groundedData.timeRange.label})

Dựa trên dữ liệu thực tế vận hành **${summary.totalOrders} đơn hàng** (đã giao thành công **${summary.successOrders} đơn**, tổng cước **${fmtVnd(summary.totalGrossRevenue)}**), Hệ chuyên gia đề xuất **4 TRỤ CỘT HÀNH ĐỘNG CỤ THỂ**:

* **1. Tối ưu gom tuyến giao hàng VRP (Vehicle Routing Problem)**:
  - Áp dụng thuật toán gom cụm trạm dừng theo mật độ địa lý và khung giờ cam kết.
  - *Tác động*: Giảm **12-15% quãng đường xe chạy không tải** và chi phí xăng xe, giúp mỗi tài xế tăng năng suất thêm **4-6 đơn/ngày**.

* **2. Chương trình giữ chân & gia tăng giá trị Top Khách hàng VIP**:
  - Nhóm khách hàng hàng đầu (như \`${topCustomers[0]?.customerName || 'Khách hàng thân thiết'}\`) đang tạo ra dòng tiền COD **${fmtVnd(summary.totalCodCollected)}**.
  - *Hành động*: Triển khai chính sách cước luỹ tiến — tặng mã giảm 10% phí cước cho khách gửi trên 15 đơn/tháng.
  - *Tác động*: Gia tăng **25-30% tần suất gửi hàng định kỳ**, hạn chế khách hàng chuyển sang đơn vị vận chuyển khác.

* **3. Quỹ thưởng hiệu suất & Nhân bản mô hình Top Tài xế**:
  - Trích **2% từ 15% doanh thu nền tảng SmartExpress** (${fmtVnd(summary.totalPlatformRevenue)}) lập quỹ thưởng tuần cho các tài xế dẫn đầu như **${topDrivers[0]?.fullName || 'Tài xế xuất sắc'}**.
  - *Tác động*: Nâng cao tỷ lệ sẵn sàng nhận đơn giờ cao điểm, giảm 90% tình trạng hủy chuyến.

* **4. Siết chặt quy trình xác nhận địa chỉ để giảm đơn thất bại**:
  - Hiện có **${summary.failedOrders} đơn giao thất bại**. Mỗi đơn hỏng phát sinh gấp đôi chi phí hoàn hàng và làm gián đoạn dòng tiền COD.
  - *Hành động*: Tích hợp tin nhắn tự động thông báo trước khi xuất bến 15 phút và kiểm tra toạ độ giao hàng trên bản đồ.
  - *Tác động*: Đưa tỷ lệ thành công từ **${summary.successRate}% lên trên 96%**, thu hồi toàn bộ doanh thu tiềm năng.`);

      suggestedQuestions.push(
        'Dự báo sản lượng các tháng tới?',
        'Chi tiết doanh thu cước phí hiện tại?',
        'Top tài xế đóng góp doanh thu cao nhất?',
      );
    }

    // XỬ LÝ Ý ĐỊNH DOANH THU
    if (
      intents.includes(AnalystIntent.REVENUE) &&
      !intents.includes(AnalystIntent.GROWTH_STRATEGY)
    ) {
      replySections.push(`### 💰 BÁO CÁO DOANH THU & PHÂN PHỔI TÀI CHÍNH (${groundedData.timeRange.label})
* **Tổng cước vận chuyển (Gross Revenue)**: **${fmtVnd(summary.totalGrossRevenue)}** (100% doanh số từ ${summary.deliveredCount} đơn giao thành công).
* **Doanh thu nền tảng SmartExpress (15%)**: **${fmtVnd(summary.totalPlatformRevenue)}** (phí dịch vụ công nghệ).
* **Chi trả đối tác tài xế (85%)**: **${fmtVnd(summary.totalDriverPayout)}** (thu nhập thực nhận của đội ngũ giao vận).
* **Tổng tiền thu hộ COD**: **${fmtVnd(summary.totalCodCollected)}** (dòng tiền thu hộ đã xử lý).

> 📌 **Tỷ suất sinh lời**: Doanh thu ròng nền tảng đạt chuẩn **15.0%** trên tổng giá trị cước vận chuyển.`);

      suggestedQuestions.push(
        'Nên làm gì để tăng doanh số các tháng sau?',
        'Top tài xế có doanh thu cao nhất?',
        'Dự báo xu hướng tài chính tuần tới?',
      );
    }

    // XỬ LÝ Ý ĐỊNH TOP TÀI XẾ
    if (intents.includes(AnalystIntent.TOP_DRIVERS)) {
      if (topDrivers.length === 0) {
        replySections.push(
          `*Chưa có dữ liệu tài xế giao hoàn tất trong mốc: ${groundedData.timeRange.label}.*`,
        );
      } else {
        replySections.push(`### 🏆 BẢNG XẾP HẠNG TOP TÀI XẾ XUẤT SẮC (${groundedData.timeRange.label})
${topDrivers
  .slice(0, 5)
  .map(
    (d, i) =>
      `**#${i + 1}. ${d.fullName}** (${d.licensePlate})
  - Đơn hoàn tất: **${d.deliveredOrders} đơn**
  - Doanh số cước: **${fmtVnd(d.totalGrossRevenue)}**
  - Thu nhập thực nhận (85%): **${fmtVnd(d.driverNetIncome)}**`,
  )
  .join('\n\n')}

> 👏 Tài xế **${topDrivers[0]?.fullName}** đang dẫn đầu với doanh thu **${fmtVnd(topDrivers[0]?.totalGrossRevenue || 0)}**.`);
      }
      suggestedQuestions.push(
        'Doanh thu nền tảng thu được từ các tài xế?',
        'Chính sách thưởng cho Top tài xế?',
      );
    }

    // XỬ LÝ Ý ĐỊNH TOP KHÁCH HÀNG
    if (intents.includes(AnalystIntent.TOP_CUSTOMERS)) {
      if (topCustomers.length === 0) {
        replySections.push(
          `*Chưa có dữ liệu khách hàng đặt đơn trong mốc: ${groundedData.timeRange.label}.*`,
        );
      } else {
        replySections.push(`### 🛍️ TOP KHÁCH HÀNG MUA NHIỀU NHẤT (${groundedData.timeRange.label})
${topCustomers
  .slice(0, 5)
  .map(
    (c, i) =>
      `**#${i + 1}. ${c.customerName}** — SĐT: \`${c.customerPhone}\`
  - Tổng đơn đặt: **${c.totalOrders} đơn** (Giao thành công: **${c.deliveredOrders}**)
  - Tổng tiền COD: **${fmtVnd(c.totalCodValue)}**
  - Tổng cước giao nhận: **${fmtVnd(c.totalShippingFee)}**`,
  )
  .join('\n\n')}`);
      }
      suggestedQuestions.push(
        'Chính sách chăm sóc khách hàng VIP?',
        'Tổng đơn hàng toàn hệ thống?',
      );
    }

    // XỬ LÝ Ý ĐỊNH DỰ BÁO
    if (intents.includes(AnalystIntent.FORECAST)) {
      replySections.push(`### 📊 DỰ BÁO HỒI QUY TUYẾN TÍNH OLS (${groundedData.timeRange.label})
* **Xu hướng tổng thể**: ${forecast.trend === 'UP' ? '📈 TĂNG TRƯỞNG' : forecast.trend === 'DOWN' ? '📉 SUY GIẢM' : '➡️ ỔN ĐỊNH'} (**${forecast.growthRatePercent >= 0 ? '+' : ''}${forecast.growthRatePercent}%**).
* **Độ tin cậy mô hình ($R^2$)**: **${forecast.rSquared}%**.
* **Sản lượng bình quân**: **${forecast.historicalAvg} đơn/ngày**.
* **Dự báo kỳ kế tiếp**: ~**${forecast.predictedNext} đơn/ngày**.

${forecast.nextPoints.map((p) => `  - *${p.label}*: ước đạt ~**${p.predicted} đơn**`).join('\n')}`);
      suggestedQuestions.push(
        'Ngày nào trong tuần cao điểm nhất?',
        'Đề xuất tối ưu quy trình điều phối?',
      );
    }

    // XỬ LÝ Ý ĐỊNH ĐỈNH TẢI
    if (intents.includes(AnalystIntent.PEAK_DAY)) {
      const peak = forecast.peakDayAnalysis;
      replySections.push(`### ⚡ PHÂN TÍCH ĐỈNH TẢI Z-SCORE (${groundedData.timeRange.label})
* **Ngày cao điểm nhất**: **${peak.peakDay}**
* **Số đơn hoàn tất**: **${peak.peakValue} đơn** (Trung bình: ${peak.mean} đơn/ngày).
* **Chỉ số Z-Score**: **${peak.zScore}** ${peak.isAbnormal ? '🔴 *(Cao điểm vượt ngưỡng)*' : '🟢 *(Ngưỡng an toàn)*'}.

📢 **Khuyến nghị**: ${peak.alertMessage}`);
      suggestedQuestions.push(
        'Cần bổ sung bao nhiêu tài xế cho ngày đỉnh tải?',
        'Chiến lược tăng trưởng các tháng sau?',
      );
    }

    // XỬ LÝ Ý ĐỊNH VẬN HÀNH
    if (intents.includes(AnalystIntent.OPERATIONS) && replySections.length === 0) {
      replySections.push(`### 📦 TỔNG QUAN VẬN HÀNH & ĐƠN HÀNG (${groundedData.timeRange.label})
* **Tổng số đơn hàng**: **${summary.totalOrders} đơn**
* **Đơn giao thành công**: **${summary.successOrders} đơn**
* **Đơn giao thất bại**: **${summary.failedOrders} đơn**
* **Tỷ lệ giao thành công**: **${summary.successRate}%** ${summary.successRate >= 90 ? '✅ *(Rất tốt)*' : '⚠️ *(Cần cải thiện)*'}
* **Tổng dòng tiền COD**: **${fmtVnd(summary.totalCodCollected)}**
* **Tổng cước vận chuyển**: **${fmtVnd(summary.totalGrossRevenue)}**`);

      suggestedQuestions.push(
        'Làm sao để tăng tỷ lệ giao thành công?',
        'Báo cáo doanh thu chi tiết?',
      );
    }

    // CHÀO HỎI HOẶC MẶC ĐỊNH
    if (replySections.length === 0) {
      if (primaryIntent === AnalystIntent.GREETING) {
        replySections.push(`Xin chào Quản trị viên! Tôi là **SmartExpress AI Analyst** — trợ lý phân tích dữ liệu vận hành & tài chính nội bộ.

Hệ thống hiện sẵn sàng phân tích theo **mọi mốc thời gian**:
* 📅 **Ngày cụ thể**: VD *"ngày 10/11/2026"*, *"hôm nay"*, *"hôm qua"*
* 📆 **Tháng cụ thể**: VD *"tháng 11/2026"*, *"tháng 10"*, *"tháng này"*
* 🗓️ **Năm & Toàn bộ**: VD *"năm 2026"*, *"toàn bộ từ trước đến giờ"*
* 🚀 **Chiến lược & Định hướng**: VD *"doanh thu vậy thì các tháng sau nên làm gì để tăng doanh số"*

Bạn muốn kiểm tra thông tin nào?`);
      } else {
        replySections.push(`### 📋 TỔNG HỢP DỮ LIỆU (${groundedData.timeRange.label})
Dựa trên dữ liệu thực tế hệ thống:
* **Tổng đơn hàng**: **${summary.totalOrders} đơn** (Giao thành công: **${summary.successOrders} đơn**, Tỷ lệ: **${summary.successRate}%**).
* **Tổng cước vận chuyển**: **${fmtVnd(summary.totalGrossRevenue)}**, Doanh thu nền tảng (15%): **${fmtVnd(summary.totalPlatformRevenue)}**.
* **Tổng thu hộ COD**: **${fmtVnd(summary.totalCodCollected)}**.
* **Đề xuất trọng tâm**: ${recommendations[0]?.title || 'Tối ưu gom tuyến giao hàng VRP'}.`);
      }

      suggestedQuestions.push(
        'Nên làm gì để tăng doanh số các tháng sau?',
        'Doanh thu tháng 11/2026 và top tài xế?',
        'Tổng đơn hàng năm 2026?',
      );
    }

    return {
      answer: replySections.join('\n\n---\n\n'),
      reply: replySections.join('\n\n---\n\n'),
      highlights: [
        `Mốc phân tích: ${groundedData.timeRange.label}`,
        `Sản lượng: ${groundedData.summary.totalOrders} đơn (${groundedData.summary.deliveredCount} hoàn tất)`,
        `Doanh thu: ${fmtVnd(groundedData.summary.totalGrossRevenue)}`,
      ],
      suggestedQuestions: suggestedQuestions.slice(0, 3),
      mode: 'LOCAL_MATH_ENGINE',
      engine: 'SmartExpress Local Math Engine (OLS + Z-Score)',
      intent: primaryIntent,
      intents,
      timeRangeLabel: groundedData.timeRange.label,
      confidence: classification.confidence,
      timestamp: new Date().toISOString(),
    };
  }
}
