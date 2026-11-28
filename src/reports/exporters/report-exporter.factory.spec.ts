import * as ExcelJS from 'exceljs';
import { ReportExporterFactory } from './report-exporter.factory';
import { AnalyticsReportData } from './report-exporter.interface';

describe('ReportExporterFactory', () => {
  const factory = new ReportExporterFactory();

  const sampleData: AnalyticsReportData = {
    revenueReport: {
      summary: {
        totalGrossRevenue: 150000,
        totalPlatformRevenue: 22500,
        totalDriverPayout: 127500,
        deliveredCount: 5,
      },
      chartData: [
        {
          label: 'T2',
          grossRevenue: 150000,
          platformRevenue: 22500,
          driverPayout: 127500,
          deliveredOrders: 5,
        },
      ],
    },
    topDriversByRevenue: [
      {
        driverId: 'drv-1',
        fullName: 'Nguyễn Văn A',
        licensePlate: '59A-123.45',
        vehicleType: 'XE_MAY',
        deliveredOrders: 12,
        totalGrossRevenue: 360000,
        platformRevenue: 54000,
        driverNetIncome: 306000,
      },
    ],
    topCustomersByOrders: [
      {
        customerName: 'Trần Thị B',
        customerPhone: '0901234567',
        deliveryAddress: '123 Lê Lợi, Q1, TP.HCM',
        totalOrders: 8,
        deliveredOrders: 7,
        totalCodValue: 2500000,
        totalShippingFee: 240000,
      },
    ],
  };

  it('supports revenue, top_drivers, and top_customers report types', () => {
    expect(factory.getSupportedTypes()).toEqual(['revenue', 'top_drivers', 'top_customers']);
  });

  it('builds Revenue worksheet via RevenueReportExporter', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = factory.getExporter('revenue').export(workbook, sampleData);

    expect(sheet.name).toBe('Báo cáo Doanh thu');
    expect(sheet.getCell('A1').value).toBe('SMARTEXPRESS LOGISTICS - BÁO CÁO DOANH THU');
    expect(sheet.getCell('B5').value).toBe('T2');
    expect(sheet.getCell('C5').value).toBe(150000);
  });

  it('builds Top Drivers worksheet via TopDriversReportExporter', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = factory.getExporter('top_drivers').export(workbook, sampleData);

    expect(sheet.name).toBe('Top Tài xế Doanh thu');
    expect(sheet.getCell('B5').value).toBe('Nguyễn Văn A');
    expect(sheet.getCell('F5').value).toBe(360000);
  });

  it('builds Top Customers worksheet and falls back to top_customers for unknown types', () => {
    const workbook1 = new ExcelJS.Workbook();
    const sheet1 = factory.getExporter('top_customers').export(workbook1, sampleData);
    expect(sheet1.name).toBe('Top Khách Hàng');
    expect(sheet1.getCell('B5').value).toBe('Trần Thị B');

    const workbook2 = new ExcelJS.Workbook();
    const sheet2 = factory.getExporter('unknown_type').export(workbook2, sampleData);
    expect(sheet2.name).toBe('Top Khách Hàng');
  });
});
