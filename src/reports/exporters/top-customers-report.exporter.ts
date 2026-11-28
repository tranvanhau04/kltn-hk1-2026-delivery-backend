import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  AnalyticsReportData,
  CURRENCY_NUM_FMT,
  IReportExporter,
  applyAnalyticsSheetHeader,
} from './report-exporter.interface';

@Injectable()
export class TopCustomersReportExporter implements IReportExporter {
  readonly type = 'top_customers' as const;

  export(workbook: ExcelJS.Workbook, data: AnalyticsReportData): ExcelJS.Worksheet {
    const sheet = workbook.addWorksheet('Top Khách Hàng');

    applyAnalyticsSheetHeader(sheet, 'SMARTEXPRESS LOGISTICS - TOP KHÁCH HÀNG', [
      'Hạng',
      'Tên Khách Hàng',
      'Số Điện Thoại',
      'Địa Chỉ',
      'Tổng Số Đơn',
      'Đơn Giao Thành Công',
      'Tổng COD',
      'Tổng Phí Ship',
    ]);

    data.topCustomersByOrders.forEach((c, idx) => {
      const row = sheet.addRow([
        idx + 1,
        c.customerName,
        c.customerPhone,
        c.deliveryAddress,
        c.totalOrders,
        c.deliveredOrders,
        c.totalCodValue,
        c.totalShippingFee,
      ]);
      row.getCell(7).numFmt = CURRENCY_NUM_FMT;
      row.getCell(8).numFmt = CURRENCY_NUM_FMT;
    });

    sheet.columns = [
      { width: 8 },
      { width: 25 },
      { width: 18 },
      { width: 40 },
      { width: 15 },
      { width: 22 },
      { width: 20 },
      { width: 20 },
    ];

    return sheet;
  }
}
