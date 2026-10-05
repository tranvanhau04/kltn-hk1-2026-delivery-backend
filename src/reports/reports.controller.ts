import { Controller, Get, Patch, Param, Body, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../entities/user.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ReconcileShiftDto } from './dto/reconcile-shift.dto';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

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
}
