import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  AnalyticsReportData,
  CURRENCY_NUM_FMT,
  IReportExporter,
  applyAnalyticsSheetHeader,
} from './report-exporter.interface';

@Injectable()
export class RevenueReportExporter implements IReportExporter {
  readonly type = 'revenue' as const;

  export(workbook: ExcelJS.Workbook, data: AnalyticsReportData): ExcelJS.Worksheet {
    const sheet = workbook.addWorksheet('Báo cáo Doanh thu');

    applyAnalyticsSheetHeader(sheet, 'SMARTEXPRESS LOGISTICS - BÁO CÁO DOANH THU', [
      'STT',
      'Ngày',
      'Tổng cước vận chuyển',
      'Doanh thu nền tảng (15%)',
      'Chi trả tài xế (85%)',
      'Số đơn giao thành công',
    ]);

    data.revenueReport.chartData.forEach((item, idx) => {
      const row = sheet.addRow([
        idx + 1,
        item.label,
        item.grossRevenue,
        item.platformRevenue,
        item.driverPayout,
        item.deliveredOrders,
      ]);
      row.getCell(3).numFmt = CURRENCY_NUM_FMT;
      row.getCell(4).numFmt = CURRENCY_NUM_FMT;
      row.getCell(5).numFmt = CURRENCY_NUM_FMT;
    });

    sheet.columns = [
      { width: 6 },
      { width: 10 },
      { width: 28 },
      { width: 28 },
      { width: 28 },
      { width: 28 },
    ];

    return sheet;
  }
}
