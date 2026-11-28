import * as ExcelJS from 'exceljs';

export type AnalyticsReportType = 'revenue' | 'top_drivers' | 'top_customers';

export interface AnalyticsReportData {
  revenueReport: {
    summary: {
      totalGrossRevenue: number;
      totalPlatformRevenue: number;
      totalDriverPayout: number;
      deliveredCount: number;
    };
    chartData: Array<{
      label: string;
      grossRevenue: number;
      platformRevenue: number;
      driverPayout: number;
      deliveredOrders: number;
    }>;
  };
  topDriversByRevenue: Array<{
    driverId: string;
    fullName: string;
    licensePlate: string;
    vehicleType: string;
    deliveredOrders: number;
    totalGrossRevenue: number;
    platformRevenue: number;
    driverNetIncome: number;
  }>;
  topCustomersByOrders: Array<{
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    totalOrders: number;
    deliveredOrders: number;
    totalCodValue: number;
    totalShippingFee: number;
  }>;
}

export const CURRENCY_NUM_FMT = '#,##0 "₫"';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F4E79' },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  size: 15,
  bold: true,
  color: { argb: 'FFFFFFFF' },
};

const COL_HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9E1F2' },
};

export function applyAnalyticsSheetHeader(
  sheet: ExcelJS.Worksheet,
  titleText: string,
  columnHeaders: string[],
): void {
  const colCount = columnHeaders.length;

  sheet.mergeCells(1, 1, 1, colCount);
  const title = sheet.getCell('A1');
  title.value = titleText;
  title.font = HEADER_FONT;
  title.fill = HEADER_FILL;
  title.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 30;

  sheet.mergeCells(2, 1, 2, colCount);
  const sub = sheet.getCell('A2');
  sub.value = `Thời gian xuất: ${new Date().toLocaleString('vi-VN')}`;
  sub.font = { italic: true, size: 10, color: { argb: 'FF595959' } };

  const hr = sheet.getRow(4);
  hr.values = columnHeaders;
  hr.font = { bold: true };
  hr.fill = COL_HEADER_FILL;
}

/**
 * Factory product contract for Excel analytics report exporters.
 * Each concrete exporter encapsulates the worksheet layout, formatting, and
 * column mapping for a single report type (Open/Closed Principle).
 */
export interface IReportExporter {
  readonly type: AnalyticsReportType;
  export(workbook: ExcelJS.Workbook, data: AnalyticsReportData): ExcelJS.Worksheet;
}
