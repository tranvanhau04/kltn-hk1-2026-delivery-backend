import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
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

  async getKpis(period: 'week' | 'month' | 'custom', startDate?: string, endDate?: string) {
    const { start, end } = this.getDateRange(period, startDate, endDate);

    // 1. Core KPI Aggregations
    const orders = await this.orderRepo.find({
      where: {
        createdAt: Between(start, end),
      },
    });

    const totalOrders = orders.length;
    const successOrders = orders.filter((o) => o.status === OrderStatus.DELIVERED).length;
    const failedOrders = orders.filter((o) => o.status === OrderStatus.FAILED).length;
    const successRate =
      totalOrders > 0 ? Number(((successOrders / totalOrders) * 100).toFixed(1)) : 0;
    const totalCodCollected = orders
      .filter((o) => o.status === OrderStatus.DELIVERED)
      .reduce((sum, o) => sum + Number(o.codAmount || 0), 0);

    // 2. Weekly Order Trends
    // Group by day of week (Monday to Sunday)
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const trendsMap = new Map<string, number>();

    // Initialize map
    for (let i = 1; i <= 6; i++) trendsMap.set(days[i], 0);
    trendsMap.set(days[0], 0);

    orders.forEach((o) => {
      const dayName = days[o.createdAt.getDay()];
      trendsMap.set(dayName, trendsMap.get(dayName)! + 1);
    });

    const weeklyOrderTrends = [
      { label: 'T2', count: trendsMap.get('T2') },
      { label: 'T3', count: trendsMap.get('T3') },
      { label: 'T4', count: trendsMap.get('T4') },
      { label: 'T5', count: trendsMap.get('T5') },
      { label: 'T6', count: trendsMap.get('T6') },
      { label: 'T7', count: trendsMap.get('T7') },
      { label: 'CN', count: trendsMap.get('CN') },
    ];

    // 3. Shift Reconciliation Overview
    const shifts = await this.shiftRepo.find({
      where: {
        startTime: Between(start, end),
      },
      relations: ['driver'],
      order: {
        startTime: 'DESC',
      },
    });

    const shiftOverview = shifts.map((shift) => ({
      shiftId: shift.id,
      driverName: `Tài xế (ID: ${shift.driverId})`,
      licensePlate: shift.driver?.licensePlate || 'N/A',
      startTime: shift.startTime,
      endTime: shift.endTime,
      codCollected: Number(shift.codCollected || 0),
      codSubmitted: Number(shift.codSubmitted || 0),
      reconciliationStatus: shift.reconciledAt ? 'RECONCILED' : 'PENDING',
      reconciledBy: shift.reconciledBy,
      reconciledAt: shift.reconciledAt,
    }));

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

  async reconcileShift(shiftId: string, dto: ReconcileShiftDto, user: JwtPayload) {
    const shift = await this.shiftRepo.findOne({
      where: { id: shiftId },
      relations: ['driver'],
    });

    if (!shift) {
      throw new NotFoundException('Không tìm thấy ca làm việc');
    }

    if (shift.reconciledAt !== null) {
      throw new BadRequestException('Ca làm việc này đã được đối soát trước đó');
    }

    shift.codSubmitted = dto.submittedAmount;
    shift.reconciledBy = user.sub;
    shift.reconciledAt = new Date();
    shift.status = ShiftStatus.CLOSED;

    // Save shift
    await this.shiftRepo.save(shift);

    // Update Driver if the shift was open
    if (
      shift.driver &&
      (shift.driver.currentShiftStatus as unknown as DriverShiftStatus) !==
        DriverShiftStatus.OFFLINE
    ) {
      shift.driver.currentShiftStatus = DriverShiftStatus.OFFLINE;
      await this.driverRepo.save(shift.driver);
    }

    const discrepancy = Number(shift.codCollected) - dto.submittedAmount;
    let discrepancyMsg = '';
    if (discrepancy > 0) {
      discrepancyMsg = ` (Thiếu ${discrepancy} VNĐ)`;
    } else if (discrepancy < 0) {
      discrepancyMsg = ` (Dư ${Math.abs(discrepancy)} VNĐ)`;
    }

    return {
      success: true,
      message: `Duyệt đối soát COD thành công${discrepancyMsg}`,
      shift,
    };
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

    // Fetch data
    let shiftQuery = this.shiftRepo
      .createQueryBuilder('shift')
      .leftJoinAndSelect('shift.driver', 'driver')
      .orderBy('shift.startTime', 'DESC');

    if (startDate)
      shiftQuery = shiftQuery.andWhere('shift.startTime >= :startDate', {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        startDate: startOfDay(new Date(startDate)),
      });
    if (endDate)
      shiftQuery = shiftQuery.andWhere('shift.startTime <= :endDate', {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        endDate: endOfDay(new Date(endDate)),
      });
    if (driverId) shiftQuery = shiftQuery.andWhere('shift.driverId = :driverId', { driverId });

    const shifts = await shiftQuery.getMany();

    shifts.forEach((s, index) => {
      const codCollected = Number(s.codCollected || 0);
      const codSubmitted = Number(s.codSubmitted || 0);
      const diff = codSubmitted - codCollected;

      const row = sheet1.addRow([
        index + 1,
        s.id,
        `Tài xế (ID: ${s.driverId})`,
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

    let orderQuery = this.orderRepo.createQueryBuilder('order').orderBy('order.updatedAt', 'DESC');

    if (startDate)
      orderQuery = orderQuery.andWhere('order.updatedAt >= :startDate', {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        startDate: startOfDay(new Date(startDate)),
      });
    if (endDate)
      orderQuery = orderQuery.andWhere('order.updatedAt <= :endDate', {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        endDate: endOfDay(new Date(endDate)),
      });
    // Note: Since Order does not have driverId natively, we omit driver filtering here or assume order.dispatcherId

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
