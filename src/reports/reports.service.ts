import { Injectable, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import { Shift, ShiftStatus } from '../entities/shift.entity';
import { Driver, DriverShiftStatus } from '../entities/driver.entity';
import { ReconcileShiftDto } from './dto/reconcile-shift.dto';
import { BulkReconcileShiftsDto } from './dto/bulk-reconcile-shifts.dto';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { S3Service } from '../s3/s3.service';
import { ReportExporterFactory } from './exporters/report-exporter.factory';
import * as ExcelJS from 'exceljs';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

@Injectable()
export class ReportsService {
  private readonly exporterFactory: ReportExporterFactory;

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
    @InjectRepository(Driver)
    private readonly driverRepo: Repository<Driver>,
    private readonly dataSource: DataSource,
    private readonly s3Service: S3Service,
    @Optional() exporterFactory?: ReportExporterFactory,
  ) {
    this.exporterFactory = exporterFactory ?? new ReportExporterFactory();
  }

  private getDateRange(period: 'week' | 'month' | 'custom', startDate?: string, endDate?: string) {
    const now = new Date();
    let start: Date;
    let end: Date;

    if (period === 'custom' && startDate && endDate) {
      start = startOfDay(new Date(startDate));
      end = endOfDay(new Date(endDate));
    } else if (period === 'month') {
      start = startOfMonth(now);
      end = endOfMonth(now);
    } else {
      // week
      start = startOfWeek(now, { weekStartsOn: 1 }); // Monday
      end = endOfWeek(now, { weekStartsOn: 1 });
    }
    return { start, end };
  }

  async getDashboardStats() {
    // Run 3 lightweight parallel SQL aggregations instead of 5 sequential round-trips + full-table RAM scan
    const [orderKpiRow, activeDrivers, dayAggRows] = await Promise.all([
      this.orderRepo
        .createQueryBuilder('o')
        .select('COUNT(o.id)', 'totalOrders')
        .addSelect(
          `COALESCE(SUM(CASE WHEN o.status = :deliveredStatus THEN 1 ELSE 0 END), 0)`,
          'deliveredCount',
        )
        .addSelect('COALESCE(SUM(o.codAmount), 0)', 'totalCOD')
        .setParameter('deliveredStatus', OrderStatus.DELIVERED)
        .getRawOne<{
          totalOrders?: string | number;
          deliveredCount?: string | number;
          totalCOD?: string | number;
        }>(),
      this.driverRepo
        .createQueryBuilder('driver')
        .where('driver.current_shift_status != :status', { status: DriverShiftStatus.OFFLINE })
        .getCount(),
      this.orderRepo
        .createQueryBuilder('o')
        .select('DAYOFWEEK(o.created_at)', 'dow')
        .addSelect('COUNT(o.id)', 'orders')
        .addSelect(
          `COALESCE(SUM(CASE WHEN o.status = :deliveredStatus THEN 1 ELSE 0 END), 0)`,
          'delivered',
        )
        .addSelect(
          `COALESCE(SUM(CASE WHEN o.status = :failedStatus THEN 1 ELSE 0 END), 0)`,
          'failed',
        )
        .setParameters({
          deliveredStatus: OrderStatus.DELIVERED,
          failedStatus: OrderStatus.FAILED,
        })
        .groupBy('DAYOFWEEK(o.created_at)')
        .getRawMany<{
          dow: string | number;
          orders: string | number;
          delivered: string | number;
          failed: string | number;
        }>(),
    ]);

    const totalOrders = Number(orderKpiRow?.totalOrders) || 0;
    const deliveredCount = Number(orderKpiRow?.deliveredCount) || 0;
    const totalCOD = Number(orderKpiRow?.totalCOD) || 0;
    const successRate =
      totalOrders > 0 ? Number(((deliveredCount / totalOrders) * 100).toFixed(1)) : 0;

    // MySQL DAYOFWEEK returns 1 = Sunday ('CN'), 2 = Monday ('T2'), ..., 7 = Saturday ('T7')
    const daysOfWeek = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const dayCounts: Record<string, { orders: number; delivered: number; failed: number }> = {
      T2: { orders: 0, delivered: 0, failed: 0 },
      T3: { orders: 0, delivered: 0, failed: 0 },
      T4: { orders: 0, delivered: 0, failed: 0 },
      T5: { orders: 0, delivered: 0, failed: 0 },
      T6: { orders: 0, delivered: 0, failed: 0 },
      T7: { orders: 0, delivered: 0, failed: 0 },
      CN: { orders: 0, delivered: 0, failed: 0 },
    };

    for (const row of dayAggRows) {
      const dowIdx = (Number(row.dow) || 1) - 1;
      const dayLabel = daysOfWeek[dowIdx];
      if (dayLabel && dayCounts[dayLabel]) {
        dayCounts[dayLabel].orders += Number(row.orders) || 0;
        dayCounts[dayLabel].delivered += Number(row.delivered) || 0;
        dayCounts[dayLabel].failed += Number(row.failed) || 0;
      }
    }

    const chartData = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((day) => ({
      day,
      orders: dayCounts[day].orders,
      delivered: dayCounts[day].delivered,
      failed: dayCounts[day].failed,
    }));

    return {
      totalOrders,
      activeDrivers,
      totalCOD,
      successRate,
      chartData,
    };
  }

  async getKpis(period: 'week' | 'month' | 'custom', startDate?: string, endDate?: string) {
    const { start, end } = this.getDateRange(period, startDate, endDate);

    // 1. Core KPI Aggregations using Native SQL
    const kpiRow = await this.orderRepo
      .createQueryBuilder('o')
      .select([
        'COUNT(o.id) AS totalOrders',
        `SUM(CASE WHEN o.status = :deliveredStatus THEN 1 ELSE 0 END) AS successOrders`,
        `SUM(CASE WHEN o.status = :failedStatus THEN 1 ELSE 0 END) AS failedOrders`,
        `COALESCE(SUM(CASE WHEN o.status = :deliveredStatus THEN o.cod_amount ELSE 0 END), 0) AS totalCodCollected`,
      ])
      .where('o.created_at >= :start AND o.created_at <= :end', {
        start,
        end,
        deliveredStatus: OrderStatus.DELIVERED,
        failedStatus: OrderStatus.FAILED,
      })
      .getRawOne<{
        totalOrders?: string | number;
        successOrders?: string | number;
        failedOrders?: string | number;
        totalCodCollected?: string | number;
      }>();

    const totalOrders = Number(kpiRow?.totalOrders || 0);
    const successOrders = Number(kpiRow?.successOrders || 0);
    const failedOrders = Number(kpiRow?.failedOrders || 0);
    const successRate =
      totalOrders > 0 ? Number(((successOrders / totalOrders) * 100).toFixed(1)) : 0;
    const totalCodCollected = Number(kpiRow?.totalCodCollected || 0);

    // 2. Weekly Order Trends using Native SQL Aggregation
    // WEEKDAY in MySQL: 0 = Mon, 1 = Tue, 2 = Wed, 3 = Thu, 4 = Fri, 5 = Sat, 6 = Sun
    const trendRows = await this.orderRepo
      .createQueryBuilder('o')
      .select(['WEEKDAY(o.created_at) AS weekday', 'COUNT(o.id) AS count'])
      .where('o.created_at >= :start AND o.created_at <= :end', { start, end })
      .groupBy('WEEKDAY(o.created_at)')
      .getRawMany<{ weekday: string | number; count: string | number }>();

    const dayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    const trendsMap = new Map<number, number>();
    for (let i = 0; i < 7; i++) {
      trendsMap.set(i, 0);
    }

    trendRows.forEach((row) => {
      const w = Number(row.weekday);
      if (!isNaN(w) && w >= 0 && w <= 6) {
        trendsMap.set(w, Number(row.count) || 0);
      }
    });

    const weeklyOrderTrends = dayLabels.map((label, index) => ({
      label,
      count: trendsMap.get(index) ?? 0,
    }));

    // 3. Shift Reconciliation Overview - Joined with users for real driver name
    const shiftsQuery = this.shiftRepo
      .createQueryBuilder('shift')
      .leftJoinAndSelect('shift.driver', 'driver')
      .leftJoin('users', 'u', 'u.id = shift.driver_id')
      .addSelect('u.full_name', 'driverFullName')
      .where('shift.start_time >= :start AND shift.start_time <= :end', { start, end })
      .orderBy('shift.start_time', 'DESC');

    const { entities: shifts, raw: rawShifts } = await shiftsQuery.getRawAndEntities<{
      driverFullName?: string;
      u_full_name?: string;
    }>();

    const shiftOverview = shifts.map((shift, idx) => {
      const raw = rawShifts[idx];
      const realDriverName =
        raw?.driverFullName ||
        raw?.u_full_name ||
        (shift.driverId ? `Tài xế #${shift.driverId.slice(0, 8)}` : 'Chưa phân công');

      return {
        shiftId: shift.id,
        driverName: realDriverName,
        licensePlate: shift.driver?.licensePlate || 'N/A',
        startTime: shift.startTime,
        endTime: shift.endTime,
        codCollected: Number(shift.codCollected || 0),
        codSubmitted: Number(shift.codSubmitted || 0),
        reconciliationStatus: shift.reconciledAt ? 'RECONCILED' : 'PENDING',
        reconciledBy: shift.reconciledBy,
        reconciledAt: shift.reconciledAt,
      };
    });

    return {
      totalOrders,
      successOrders,
      failedOrders,
      successRate,
      totalCodCollected,
      weeklyOrderTrends,
      shiftOverview,
    };
  }

  /**
   * Reconcile shift with pessimistic write lock and transaction
   * Guarantees atomicity and prevents concurrent reconciliation race conditions
   */
  async reconcileShift(shiftId: string, dto: ReconcileShiftDto, user: JwtPayload) {
    return this.dataSource.transaction(async (manager) => {
      // 1. Fetch shift with pessimistic locking to avoid concurrency anomalies
      const shift = await manager.findOne(Shift, {
        where: { id: shiftId },
        relations: ['driver'],
        lock: { mode: 'pessimistic_write' },
      });

      if (!shift) {
        throw new NotFoundException('Không tìm thấy ca làm việc');
      }

      if (shift.status === ShiftStatus.CLOSED || shift.reconciledAt !== null) {
        throw new BadRequestException('Ca làm việc này đã được đối soát trước đó');
      }

      // 2. Update shift reconciliation info
      shift.codSubmitted = dto.submittedAmount;
      shift.reconciledBy = user.sub;
      shift.reconciledAt = new Date();
      shift.status = ShiftStatus.CLOSED;

      await manager.save(Shift, shift);

      // 3. Atomically update Driver status to OFFLINE if not already
      if (
        shift.driver &&
        (shift.driver.currentShiftStatus as unknown as DriverShiftStatus) !==
          DriverShiftStatus.OFFLINE
      ) {
        shift.driver.currentShiftStatus = DriverShiftStatus.OFFLINE;
        await manager.save(Driver, shift.driver);
      }

      const discrepancy = Number(shift.codCollected) - dto.submittedAmount;
      let discrepancyMsg = '';
      if (discrepancy > 0) {
        discrepancyMsg = ` (Thiếu ${discrepancy.toLocaleString('vi-VN')} VNĐ)`;
      } else if (discrepancy < 0) {
        discrepancyMsg = ` (Dư ${Math.abs(discrepancy).toLocaleString('vi-VN')} VNĐ)`;
      } else {
        discrepancyMsg = ' (Khớp 100%)';
      }

      return {
        success: true,
        message: `Duyệt đối soát COD thành công${discrepancyMsg}`,
        shift,
      };
    });
  }

  /**
   * GET /reports/shifts/:id
   * Lấy chi tiết ca làm việc: thông tin tài xế, dòng tiền COD, danh sách đơn hàng, ảnh POD
   */
  async getShiftDetail(shiftId: string) {
    // 1. Lấy shift + driver relation
    const shift = await this.shiftRepo.findOne({
      where: { id: shiftId },
      relations: ['driver'],
    });

    if (!shift) {
      throw new NotFoundException('Không tìm thấy ca làm việc');
    }

    // 2. Lấy tên thật của tài xế từ bảng users
    const userRow = await this.dataSource.query<{ full_name: string; phone: string }[]>(
      `SELECT full_name, phone FROM users WHERE id = ? LIMIT 1`,
      [shift.driverId],
    );
    const driverFullName =
      userRow?.[0]?.full_name ||
      (shift.driverId ? `Tài xế #${shift.driverId.slice(0, 8)}` : 'Chưa phân công');
    const driverPhone = userRow?.[0]?.phone || null;

    // 3. Lấy route liên kết với ca này (một ca có thể có nhiều route, lấy route gần nhất)
    const routeRow = await this.dataSource.query<
      {
        id: string;
        total_distance_km: number;
        total_estimated_time_min: number;
        status: string;
      }[]
    >(
      `SELECT id, total_distance_km, total_estimated_time_min, status
       FROM routes WHERE shift_id = ? ORDER BY created_at DESC LIMIT 1`,
      [shiftId],
    );
    const route = routeRow?.[0] || null;

    // 4. Lấy danh sách stops + order + POD nếu có route
    const stopsDetail: Array<{
      stopId: string;
      sequenceNo: number;
      status: string;
      arrivedAt: Date | null;
      orderId: string;
      orderCode: string;
      receiverName: string;
      receiverPhone: string;
      deliveryAddress: string;
      codAmount: number;
      pod: {
        photoUrl: string | null;
        codCollected: number;
        failureReason: string | null;
        confirmedAt: Date | null;
      } | null;
    }> = [];

    let totalOrders = 0;
    let deliveredCount = 0;
    let failedCount = 0;

    if (route) {
      const rawStops = await this.dataSource.query<
        {
          stop_id: string;
          sequence_no: number;
          stop_status: string;
          arrived_at: Date | null;
          order_id: string;
          order_code: string;
          receiver_name: string;
          receiver_phone: string;
          delivery_address: string;
          cod_amount: number;
          pod_id: string | null;
          pod_photo_url: string | null;
          pod_cod_collected: number | null;
          pod_failure_reason: string | null;
          pod_confirmed_at: Date | null;
        }[]
      >(
        `SELECT
           s.id AS stop_id,
           s.sequence_no,
           s.status AS stop_status,
           s.arrived_at,
           o.id AS order_id,
           o.code AS order_code,
           o.receiver_name,
           o.receiver_phone,
           o.delivery_address,
           COALESCE(o.cod_amount, 0) AS cod_amount,
           p.id AS pod_id,
           p.photo_url AS pod_photo_url,
           p.cod_collected AS pod_cod_collected,
           p.failure_reason AS pod_failure_reason,
           p.confirmed_at AS pod_confirmed_at
         FROM stops s
         INNER JOIN orders o ON o.id = s.order_id
         LEFT JOIN proof_of_deliveries p ON p.stop_id = s.id
         WHERE s.route_id = ?
         ORDER BY s.sequence_no ASC`,
        [route.id],
      );

      totalOrders = rawStops.length;

      for (const row of rawStops) {
        if (row.stop_status === 'COMPLETED') deliveredCount++;
        if (row.stop_status === 'FAILED') failedCount++;

        // Sinh presigned URL cho ảnh POD
        const presignedPhotoUrl = row.pod_photo_url
          ? await this.s3Service.getPresignedUrl(row.pod_photo_url)
          : null;

        stopsDetail.push({
          stopId: row.stop_id,
          sequenceNo: row.sequence_no,
          status: row.stop_status,
          arrivedAt: row.arrived_at,
          orderId: row.order_id,
          orderCode: row.order_code || row.order_id.slice(0, 8).toUpperCase(),
          receiverName: row.receiver_name,
          receiverPhone: row.receiver_phone,
          deliveryAddress: row.delivery_address,
          codAmount: Number(row.cod_amount || 0),
          pod: row.pod_id
            ? {
                photoUrl: presignedPhotoUrl,
                codCollected: Number(row.pod_cod_collected || 0),
                failureReason: row.pod_failure_reason,
                confirmedAt: row.pod_confirmed_at,
              }
            : null,
        });
      }
    }

    const codCollected = Number(shift.codCollected || 0);
    const codSubmitted = Number(shift.codSubmitted || 0);

    return {
      shiftId: shift.id,
      driverId: shift.driverId,
      driverName: driverFullName,
      driverPhone,
      licensePlate: shift.driver?.licensePlate || 'N/A',
      vehicleType: shift.driver?.vehicleType || 'N/A',
      startTime: shift.startTime,
      endTime: shift.endTime,
      status: shift.status,
      startingCashCod: Number(shift.startingCashCod || 0),
      codCollected,
      codSubmitted,
      codDifference: codCollected - codSubmitted,
      reconciledBy: shift.reconciledBy,
      reconciledAt: shift.reconciledAt,
      route: route
        ? {
            id: route.id,
            totalDistanceKm: Number(route.total_distance_km || 0),
            totalEstimatedTimeMin: Number(route.total_estimated_time_min || 0),
            status: route.status,
            totalOrders,
            deliveredCount,
            failedCount,
          }
        : null,
      stops: stopsDetail,
    };
  }

  /**
   * POST /reports/shifts/bulk-reconcile
   * Duyệt đối soát COD hàng loạt cho nhiều ca cùng lúc
   */
  async bulkReconcileShifts(dto: BulkReconcileShiftsDto, user: JwtPayload) {
    return this.dataSource.transaction(async (manager) => {
      // 1. Lấy tất cả shifts với pessimistic write lock
      const shifts = await manager.find(Shift, {
        where: { id: In(dto.shiftIds) },
        relations: ['driver'],
        lock: { mode: 'pessimistic_write' },
      });

      if (shifts.length === 0) {
        throw new NotFoundException('Không tìm thấy ca làm việc nào');
      }

      // 2. Lọc bỏ các ca đã đối soát rồi
      const pendingShifts = shifts.filter((s) => s.reconciledAt === null);

      if (pendingShifts.length === 0) {
        throw new BadRequestException('Tất cả ca đã được đối soát trước đó');
      }

      const reconciledShiftIds: string[] = [];
      const now = new Date();

      // 3. Cập nhật từng ca chờ đối soát
      for (const shift of pendingShifts) {
        shift.status = ShiftStatus.CLOSED;
        // Nếu chưa có codSubmitted thì mặc định = codCollected (khớp 100%)
        if (!shift.codSubmitted || Number(shift.codSubmitted) === 0) {
          shift.codSubmitted = Number(shift.codCollected);
        }
        shift.reconciledBy = user.sub;
        shift.reconciledAt = now;
        reconciledShiftIds.push(shift.id);
      }

      // 4. Bulk save shifts
      await manager.save(Shift, pendingShifts);

      // 5. Cập nhật trạng thái tài xế sang OFFLINE
      const driverIds = pendingShifts
        .filter(
          (s) =>
            s.driver &&
            (s.driver.currentShiftStatus as unknown as DriverShiftStatus) !==
              DriverShiftStatus.OFFLINE,
        )
        .map((s) => s.driver.userId);

      if (driverIds.length > 0) {
        await manager
          .createQueryBuilder()
          .update(Driver)
          .set({ currentShiftStatus: DriverShiftStatus.OFFLINE })
          .where('user_id IN (:...ids)', { ids: driverIds })
          .execute();
      }

      const skippedCount = shifts.length - pendingShifts.length;

      return {
        success: true,
        reconciledCount: reconciledShiftIds.length,
        reconciledShiftIds,
        skippedCount,
        message: `Đã duyệt ${reconciledShiftIds.length} ca${skippedCount > 0 ? `, bỏ qua ${skippedCount} ca đã đối soát` : ''}`,
      };
    });
  }

  async generateExcelExport(
    startDate?: string,
    endDate?: string,
    driverId?: string,
  ): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SmartExpress System';
    workbook.created = new Date();

    // -- Sheet 1: Đối soát Ca --
    const sheet1 = workbook.addWorksheet('Tổng quan & Đối soát Ca');

    // Header
    sheet1.mergeCells('A1:L1');
    const titleCell = sheet1.getCell('A1');
    titleCell.value = 'SMARTEXPRESS LOGISTICS - BÁO CÁO ĐỐI SOÁT CA LÀM VIỆC';
    titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet1.getRow(1).height = 30;

    const timeCell = sheet1.getCell('A2');
    timeCell.value = `Thời gian xuất báo cáo: ${new Date().toLocaleString('vi-VN')}`;
    sheet1.mergeCells('A2:L2');

    // Columns
    sheet1.getRow(4).values = [
      'STT',
      'Mã Ca',
      'Tên Tài Xế',
      'Biển Số Xe',
      'Bắt Đầu',
      'Kết Thúc',
      'COD Đã Thu (VNĐ)',
      'COD Thực Nộp (VNĐ)',
      'Chênh Lệch',
      'Trạng Thái',
      'Người Duyệt',
      'Thời Gian Duyệt',
    ];
    sheet1.getRow(4).font = { bold: true };
    sheet1.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

    // Fetch data with driver full name via users table join
    let shiftQuery = this.shiftRepo
      .createQueryBuilder('shift')
      .leftJoinAndSelect('shift.driver', 'driver')
      .leftJoin('users', 'u', 'u.id = shift.driver_id')
      .addSelect('u.full_name', 'driverFullName')
      .orderBy('shift.start_time', 'DESC');

    if (startDate) {
      shiftQuery = shiftQuery.andWhere('shift.start_time >= :startDate', {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        startDate: startOfDay(new Date(startDate)),
      });
    }
    if (endDate) {
      shiftQuery = shiftQuery.andWhere('shift.start_time <= :endDate', {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        endDate: endOfDay(new Date(endDate)),
      });
    }
    if (driverId) {
      shiftQuery = shiftQuery.andWhere('shift.driver_id = :driverId', { driverId });
    }

    const { entities: shifts, raw: rawShifts } = await shiftQuery.getRawAndEntities<{
      driverFullName?: string;
      u_full_name?: string;
    }>();

    shifts.forEach((s, index) => {
      const codCollected = Number(s.codCollected || 0);
      const codSubmitted = Number(s.codSubmitted || 0);
      const diff = codSubmitted - codCollected;
      const raw = rawShifts[index];
      const realDriverName =
        raw?.driverFullName ||
        raw?.u_full_name ||
        (s.driverId ? `Tài xế #${s.driverId.slice(0, 8)}` : 'Chưa phân công');

      const row = sheet1.addRow([
        index + 1,
        s.id,
        realDriverName,
        s.driver?.licensePlate || 'N/A',
        s.startTime ? new Date(s.startTime).toLocaleString('vi-VN') : '',
        s.endTime ? new Date(s.endTime).toLocaleString('vi-VN') : '',
        codCollected,
        codSubmitted,
        diff,
        s.reconciledAt ? 'ĐÃ ĐỐI SOÁT' : 'CHỜ ĐỐI SOÁT',
        s.reconciledBy || '',
        s.reconciledAt ? new Date(s.reconciledAt).toLocaleString('vi-VN') : '',
      ]);

      // Formatting numbers
      row.getCell(7).numFmt = '#,##0 "₫"';
      row.getCell(8).numFmt = '#,##0 "₫"';
      row.getCell(9).numFmt = '#,##0 "₫"';
    });

    // Auto-fit columns
    sheet1.columns.forEach((column) => {
      column.width = 20;
    });
    sheet1.getColumn(1).width = 5;
    sheet1.getColumn(2).width = 38;

    // -- Sheet 2: Chi tiết Đơn hàng --
    const sheet2 = workbook.addWorksheet('Chi tiết Đơn hàng Giao');

    sheet2.mergeCells('A1:J1');
    const titleCell2 = sheet2.getCell('A1');
    titleCell2.value = 'CHI TIẾT ĐƠN HÀNG GIAO TRONG KỲ';
    titleCell2.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    titleCell2.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet2.getRow(1).height = 30;

    sheet2.getRow(3).values = [
      'STT',
      'Mã Đơn Hàng',
      'Mã Vùng',
      'Tên Khách Hàng',
      'Số Điện Thoại',
      'Địa Chỉ',
      'Trọng Lượng (kg)',
      'Tiền Thu Hộ COD (VNĐ)',
      'Trạng Thái',
      'Thời Gian Cập Nhật',
    ];
    sheet2.getRow(3).font = { bold: true };
    sheet2.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

    let orderQuery = this.orderRepo.createQueryBuilder('order').orderBy('order.updated_at', 'DESC');

    if (startDate) {
      orderQuery = orderQuery.andWhere('order.updated_at >= :startDate', {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        startDate: startOfDay(new Date(startDate)),
      });
    }
    if (endDate) {
      orderQuery = orderQuery.andWhere('order.updated_at <= :endDate', {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        endDate: endOfDay(new Date(endDate)),
      });
    }

    const orders = await orderQuery.getMany();

    orders.forEach((o, index) => {
      const row = sheet2.addRow([
        index + 1,
        o.id,
        o.zoneId || '',
        o.receiverName,
        o.receiverPhone,
        o.deliveryAddress,
        Number(o.weightKg || 0),
        Number(o.codAmount || 0),
        o.status,
        o.updatedAt ? new Date(o.updatedAt).toLocaleString('vi-VN') : '',
      ]);

      row.getCell(8).numFmt = '#,##0 "₫"';
    });

    sheet2.columns.forEach((column) => {
      column.width = 20;
    });
    sheet2.getColumn(1).width = 5;
    sheet2.getColumn(2).width = 38;
    sheet2.getColumn(6).width = 40;

    return workbook;
  }

  /**
   * Export all orders with driver and route info to Excel (.xlsx)
   */
  async generateOrdersExcelExport(
    startDate?: string,
    endDate?: string,
    status?: string,
  ): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SmartExpress Logistics';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Danh sách Đơn hàng');

    // Title Banner
    sheet.mergeCells('A1:G1');
    const title = sheet.getCell('A1');
    title.value = 'SMARTEXPRESS LOGISTICS - BÁO CÁO DANH SÁCH ĐƠN HÀNG';
    title.font = { size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    title.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 30;

    sheet.mergeCells('A2:G2');
    const subtitle = sheet.getCell('A2');
    subtitle.value = `Thời gian xuất: ${new Date().toLocaleString('vi-VN')}`;
    subtitle.font = { italic: true, size: 10, color: { argb: 'FF595959' } };
    subtitle.alignment = { vertical: 'middle', horizontal: 'left' };
    sheet.getRow(2).height = 20;

    // Header row
    const headerRow = sheet.getRow(4);
    headerRow.values = [
      'Mã Đơn',
      'Trạng thái',
      'Tiền Thu Hộ (COD)',
      'Phí giao hàng',
      'Người nhận',
      'Địa chỉ',
      'Tài xế',
    ];
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;

    // Query orders with route and driver
    const qb = this.orderRepo
      .createQueryBuilder('order')
      .leftJoin('stops', 'stop', 'stop.order_id = order.id')
      .leftJoin('routes', 'route', 'route.id = stop.route_id')
      .leftJoin('users', 'driver_user', 'driver_user.id = route.driver_id')
      .addSelect('driver_user.full_name', 'driverName')
      .addSelect('route.driver_id', 'driverId')
      .orderBy('order.created_at', 'DESC');

    if (startDate) {
      qb.andWhere('order.created_at >= :startDate', {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        startDate: startOfDay(new Date(startDate)),
      });
    }
    if (endDate) {
      qb.andWhere('order.created_at <= :endDate', {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        endDate: endOfDay(new Date(endDate)),
      });
    }
    if (status && status !== 'ALL') {
      qb.andWhere('order.status = :status', { status });
    }

    const { entities: orders, raw } = await qb.getRawAndEntities<{
      driverName?: string;
      driver_user_full_name?: string;
    }>();

    const STATUS_MAP: Record<string, string> = {
      NEW: 'Chờ phân công',
      ASSIGNED: 'Đã phân công',
      IN_TRANSIT: 'Đang giao hàng',
      DELIVERED: 'Giao thành công',
      FAILED: 'Giao thất bại',
      RESCHEDULED: 'Hẹn giao lại',
      CANCELLED: 'Đã hủy',
    };

    orders.forEach((o, index) => {
      const rawItem = raw[index];
      const driverName = rawItem?.driverName || rawItem?.driver_user_full_name || 'Chưa phân công';
      const weight = Number(o.weightKg || 1);
      const deliveryFee = Math.round(20000 + Math.max(0, weight - 1) * 5000);

      const row = sheet.addRow([
        o.code || o.id,
        STATUS_MAP[o.status] || o.status,
        Number(o.codAmount || 0),
        deliveryFee,
        `${o.receiverName} (${o.receiverPhone})`,
        o.deliveryAddress,
        driverName,
      ]);

      // Formatting
      row.getCell(3).numFmt = '#,##0 "₫"';
      row.getCell(4).numFmt = '#,##0 "₫"';
      row.getCell(1).alignment = { horizontal: 'center' };
      row.getCell(2).alignment = { horizontal: 'center' };
      row.getCell(3).alignment = { horizontal: 'right' };
      row.getCell(4).alignment = { horizontal: 'right' };
      row.getCell(5).alignment = { horizontal: 'left' };
      row.getCell(6).alignment = { horizontal: 'left' };
      row.getCell(7).alignment = { horizontal: 'left' };
    });

    sheet.columns = [
      { width: 20 },
      { width: 18 },
      { width: 22 },
      { width: 18 },
      { width: 30 },
      { width: 45 },
      { width: 25 },
    ];

    return workbook;
  }

  // ─── Analytics ───────────────────────────────────────────────────────

  private computeGrossFee(order: Order): number {
    const rawFee = Number(order.deliveryFee);
    return rawFee > 0
      ? rawFee
      : Math.min(60000, Math.round((20000 + 2000 * Number(order.weightKg || 0)) / 1000) * 1000);
  }

  private computeRevenueSplit(grossFee: number) {
    const platformRevenue = Math.round((grossFee * 0.15) / 1000) * 1000;
    const driverIncome = grossFee - platformRevenue;
    return { platformRevenue, driverIncome };
  }

  async getAnalytics(days: number) {
    const end = endOfDay(new Date());
    const start = startOfDay(new Date());
    start.setDate(start.getDate() - days);

    // ── 1. Revenue Report ──────────────────────────────────────────────
    const deliveredOrders = await this.orderRepo
      .createQueryBuilder('o')
      .where('o.status = :status', { status: OrderStatus.DELIVERED })
      .andWhere('o.created_at >= :start AND o.created_at <= :end', { start, end })
      .getMany();

    let totalGrossRevenue = 0;
    let totalPlatformRevenue = 0;
    let totalDriverPayout = 0;

    const dayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    const weekBuckets = dayLabels.map((label) => ({
      label,
      grossRevenue: 0,
      platformRevenue: 0,
      driverPayout: 0,
      deliveredOrders: 0,
    }));

    deliveredOrders.forEach((o) => {
      const grossFee = this.computeGrossFee(o);
      const { platformRevenue, driverIncome } = this.computeRevenueSplit(grossFee);

      totalGrossRevenue += grossFee;
      totalPlatformRevenue += platformRevenue;
      totalDriverPayout += driverIncome;

      const d = o.createdAt ? new Date(o.createdAt) : new Date();
      // MySQL WEEKDAY: 0=Mon … 6=Sun  |  JS getDay: 0=Sun … 6=Sat
      const jsDay = d.getDay();
      const weekdayIdx = jsDay === 0 ? 6 : jsDay - 1; // map to 0=Mon…6=Sun
      weekBuckets[weekdayIdx].grossRevenue += grossFee;
      weekBuckets[weekdayIdx].platformRevenue += platformRevenue;
      weekBuckets[weekdayIdx].driverPayout += driverIncome;
      weekBuckets[weekdayIdx].deliveredOrders += 1;
    });

    const revenueReport = {
      summary: {
        totalGrossRevenue,
        totalPlatformRevenue,
        totalDriverPayout,
        deliveredCount: deliveredOrders.length,
      },
      chartData: weekBuckets,
    };

    // ── 2. Top Drivers by Revenue ──────────────────────────────────────
    const driverOrders = await this.orderRepo
      .createQueryBuilder('o')
      .leftJoin('drivers', 'd', 'd.user_id = o.driver_id')
      .leftJoin('users', 'u', 'u.id = d.user_id')
      .addSelect('d.user_id', 'd_user_id')
      .addSelect('u.full_name', 'u_full_name')
      .addSelect('d.license_plate', 'd_license_plate')
      .addSelect('d.vehicle_type', 'd_vehicle_type')
      .where('o.status = :status', { status: OrderStatus.DELIVERED })
      .andWhere('o.created_at >= :start AND o.created_at <= :end', { start, end })
      .getRawAndEntities();

    const driverMap = new Map<
      string,
      {
        driverId: string;
        fullName: string;
        licensePlate: string;
        vehicleType: string;
        deliveredOrders: number;
        totalGrossRevenue: number;
        platformRevenue: number;
        driverNetIncome: number;
      }
    >();

    driverOrders.entities.forEach((o, idx) => {
      const raw = driverOrders.raw[idx] as Record<string, string | undefined>;
      const dId = o.driverId || (raw['d_user_id'] ?? '');
      if (!dId) return;

      const grossFee = this.computeGrossFee(o);
      const { platformRevenue, driverIncome } = this.computeRevenueSplit(grossFee);

      const existing = driverMap.get(dId);
      if (existing) {
        existing.deliveredOrders += 1;
        existing.totalGrossRevenue += grossFee;
        existing.platformRevenue += platformRevenue;
        existing.driverNetIncome += driverIncome;
      } else {
        driverMap.set(dId, {
          driverId: dId,
          fullName: raw['u_full_name'] ?? `Tài xế #${dId.slice(0, 8)}`,
          licensePlate: raw['d_license_plate'] ?? 'N/A',
          vehicleType: raw['d_vehicle_type'] ?? 'N/A',
          deliveredOrders: 1,
          totalGrossRevenue: grossFee,
          platformRevenue,
          driverNetIncome: driverIncome,
        });
      }
    });

    const topDriversByRevenue = [...driverMap.values()]
      .sort((a, b) => b.totalGrossRevenue - a.totalGrossRevenue)
      .slice(0, 10);

    // ── 3. Top Customers by Orders ─────────────────────────────────────
    const customerOrders = await this.orderRepo
      .createQueryBuilder('o')
      .where('o.status != :cancelled', { cancelled: OrderStatus.CANCELLED })
      .andWhere('o.created_at >= :start AND o.created_at <= :end', { start, end })
      .getMany();

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

    customerOrders.forEach((o) => {
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

    const topCustomersByOrders = [...customerMap.values()]
      .sort((a, b) => b.totalOrders - a.totalOrders || b.totalCodValue - a.totalCodValue)
      .slice(0, 10);

    return { revenueReport, topDriversByRevenue, topCustomersByOrders };
  }

  // ─── Analytics Excel Export ──────────────────────────────────────────

  async generateAnalyticsExcelExport(days: number, type: string): Promise<ExcelJS.Workbook> {
    const data = await this.getAnalytics(days);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SmartExpress System';
    workbook.created = new Date();

    const exporter = this.exporterFactory.getExporter(type);
    exporter.export(workbook, data);

    return workbook;
  }
}
