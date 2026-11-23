import { Controller, Get, Patch, Param, Body, Query, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { ReportsService } from './reports.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../entities/user.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ReconcileShiftDto } from './dto/reconcile-shift.dto';

@Controller('reports')
@Roles(UserRole.ADMIN, UserRole.DISPATCHER)
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

  /**
   * GET /reports/analytics
   * Analytics overview: revenue, top drivers, top customers
   */
  @Get('analytics')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async getAnalytics(@Query('days') days?: string, @Query('period') period?: string) {
    let numDays = Number(days);
    if (!numDays || isNaN(numDays)) {
      if (period === 'month' || period === '30' || period === '30d') numDays = 30;
      else if (period === 'custom' || period === '90' || period === '90d') numDays = 90;
      else if (period === 'week' || period === '7' || period === '7d') numDays = 7;
      else numDays = Number(period) || 7;
    }
    return this.reportsService.getAnalytics(numDays);
  }

  /**
   * GET /reports/export-analytics
   * Export analytics to Excel (.xlsx)
   */
  @Get('export-analytics')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async exportAnalyticsExcel(
    @Res() res: Response,
    @Query('days') days?: string,
    @Query('period') period?: string,
    @Query('type') type?: string,
  ) {
    let numDays = Number(days);
    if (!numDays || isNaN(numDays)) {
      if (period === 'month' || period === '30' || period === '30d') numDays = 30;
      else if (period === 'custom' || period === '90' || period === '90d') numDays = 90;
      else if (period === 'week' || period === '7' || period === '7d') numDays = 7;
      else numDays = Number(period) || 7;
    }
    const workbook = await this.reportsService.generateAnalyticsExcelExport(
      numDays,
      type || 'revenue',
    );
    const typeNameMap: Record<string, string> = {
      revenue: 'doanh-thu',
      top_drivers: 'top-tai-xe',
      top_customers: 'top-khach-hang',
    };
    const suffix = (type && typeNameMap[type]) || 'phan-tich';
    const filename = `Bao-cao-${suffix}-SmartExpress-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  }
}
