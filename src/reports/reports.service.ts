import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import { Shift, ShiftStatus } from '../entities/shift.entity';
import { Driver, DriverShiftStatus } from '../entities/driver.entity';
import { ReconcileShiftDto } from './dto/reconcile-shift.dto';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import * as ExcelJS from 'exceljs';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
    @InjectRepository(Driver)
    private readonly driverRepo: Repository<Driver>,
    private readonly dataSource: DataSource,
  ) {}

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
    const totalOrders = await this.orderRepo.count();

    const activeDrivers = await this.driverRepo
      .createQueryBuilder('driver')
      .where('driver.current_shift_status != :status', { status: DriverShiftStatus.OFFLINE })
      .getCount();

    const codResult = await this.orderRepo
      .createQueryBuilder('order')
      .select('SUM(order.codAmount)', 'total')
      .getRawOne();
    const totalCOD = Number(codResult?.total || 0);

    const deliveredCount = await this.orderRepo.count({
      where: { status: OrderStatus.DELIVERED },
    });
    const failedCount = await this.orderRepo.count({
      where: { status: OrderStatus.FAILED },
    });

    const successRate =
      totalOrders > 0
        ? Number(((deliveredCount / totalOrders) * 100).toFixed(1))
        : 0;

    // Group by day of week based on existing orders
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

    const allOrders = await this.orderRepo.find({
      select: ['id', 'status', 'createdAt'],
    });

    allOrders.forEach((o) => {
      const d = o.createdAt ? new Date(o.createdAt) : new Date();
      const dayLabel = daysOfWeek[d.getDay()];
      if (dayCounts[dayLabel]) {
        dayCounts[dayLabel].orders += 1;
        if (o.status === OrderStatus.DELIVERED) dayCounts[dayLabel].delivered += 1;
        if (o.status === OrderStatus.FAILED) dayCounts[dayLabel].failed += 1;
      }
    });

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
}
