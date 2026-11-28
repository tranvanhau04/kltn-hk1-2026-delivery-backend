import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  AnalyticsReportData,
  CURRENCY_NUM_FMT,
  IReportExporter,
  applyAnalyticsSheetHeader,
} from './report-exporter.interface';

@Injectable()
export class TopDriversReportExporter implements IReportExporter {
  readonly type = 'top_drivers' as const;

  export(workbook: ExcelJS.Workbook, data: AnalyticsReportData): ExcelJS.Worksheet {
    const sheet = workbook.addWorksheet('Top Tài xế Doanh thu');

    applyAnalyticsSheetHeader(sheet, 'SMARTEXPRESS LOGISTICS - TOP TÀI XẾ DOANH THU', [
      'Hạng',
      'Tên Tài Xế',
      'Biển Số Xe',
      'Loại Xe',
      'Số Đơn Đã Giao',
      'Tổng Doanh Thu Cước',
      'Chiết Khấu NTT (15%)',
      'Thu Nhập Thực Nhận (85%)',
    ]);

    data.topDriversByRevenue.forEach((d, idx) => {
      const row = sheet.addRow([
        idx + 1,
        d.fullName,
        d.licensePlate,
        d.vehicleType,
        d.deliveredOrders,
        d.totalGrossRevenue,
        d.platformRevenue,
        d.driverNetIncome,
      ]);
      row.getCell(6).numFmt = CURRENCY_NUM_FMT;
      row.getCell(7).numFmt = CURRENCY_NUM_FMT;
      row.getCell(8).numFmt = CURRENCY_NUM_FMT;
    });

    sheet.columns = [
      { width: 8 },
      { width: 25 },
      { width: 15 },
      { width: 15 },
      { width: 18 },
      { width: 25 },
      { width: 25 },
      { width: 28 },
    ];

    return sheet;
  }
}
