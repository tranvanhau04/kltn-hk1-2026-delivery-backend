import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  Res,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { ReportsService } from './reports.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../entities/user.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ReconcileShiftDto } from './dto/reconcile-shift.dto';
import { BulkReconcileShiftsDto } from './dto/bulk-reconcile-shifts.dto';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * GET /reports/dashboard
   * Realtime dashboard summary metrics & charts
   */
  @Get('dashboard')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @UseInterceptors(CacheInterceptor)
  @CacheKey('dashboard_stats')
  @CacheTTL(60000)
  async getDashboard() {
    return this.reportsService.getDashboardStats();
  }

  /**
   * GET /reports/kpis (or /reports)
   * Performance & KPI Analytics
   */
  @Get('kpis')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async getKpis(
    @Query('period') period?: 'week' | 'month' | 'custom',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getKpis(period || 'week', startDate, endDate);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async getReports(
    @Query('period') period?: 'week' | 'month' | 'custom',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getKpis(period || 'week', startDate, endDate);
  }

  /**
   * GET /reports/shifts/:id
   * Chi tiết ca làm việc: thông tin tài xế, dòng tiền COD, danh sách đơn, ảnh POD
   */
  @Get('/shifts/:id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async getShiftDetail(@Param('id') shiftId: string) {
    return this.reportsService.getShiftDetail(shiftId);
  }

  /**
   * POST /reports/shifts/bulk-reconcile
   * Duyệt đối soát COD hàng loạt cho nhiều ca cùng lúc
   */
  @Post('/shifts/bulk-reconcile')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async bulkReconcileShifts(@Body() dto: BulkReconcileShiftsDto, @CurrentUser() user: JwtPayload) {
    return this.reportsService.bulkReconcileShifts(dto, user);
  }

  /**
   * PATCH /shifts/:id/reconcile
   * Shift Reconciliation API
   * Note: Mounted under /shifts/:id/reconcile in this controller for convenience,
   * but mapped to the shifts route prefix via path.
   */
  @Patch('/shifts/:id/reconcile')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async reconcileShift(
    @Param('id') shiftId: string,
    @Body() dto: ReconcileShiftDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.reportsService.reconcileShift(shiftId, dto, user);
  }

  /**
   * GET /reports/export/excel
   * Excel Financial & Operational Export Service
   */
  @Get('export/excel')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async exportExcel(
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('driverId') driverId?: string,
  ) {
    const workbook = await this.reportsService.generateExcelExport(startDate, endDate, driverId);

    const filename = `Bao-cao-doi-soat-SmartExpress-${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  }

  /**
   * GET /api/reports/export/orders
   * Export Orders to Excel (.xlsx)
   */
  @Get('export/orders')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async exportOrdersExcel(
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
  ) {
    const workbook = await this.reportsService.generateOrdersExcelExport(
      startDate,
      endDate,
      status,
    );

    const filename = `orders_export.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  }
}
