import { Injectable, Optional } from '@nestjs/common';
import { AnalyticsReportType, IReportExporter } from './report-exporter.interface';
import { RevenueReportExporter } from './revenue-report.exporter';
import { TopDriversReportExporter } from './top-drivers-report.exporter';
import { TopCustomersReportExporter } from './top-customers-report.exporter';

/**
 * Factory resolving the concrete Excel report exporter by report type.
 * Eliminates the monolithic if/else-if/else chain in ReportsService and allows
 * registering new report tabs without modifying existing export logic.
 */
@Injectable()
export class ReportExporterFactory {
  private readonly exporters: Map<string, IReportExporter>;
  private readonly defaultExporter: IReportExporter;

  constructor(
    @Optional() revenueExporter?: RevenueReportExporter,
    @Optional() topDriversExporter?: TopDriversReportExporter,
    @Optional() topCustomersExporter?: TopCustomersReportExporter,
  ) {
    const rev = revenueExporter ?? new RevenueReportExporter();
    const drivers = topDriversExporter ?? new TopDriversReportExporter();
    const customers = topCustomersExporter ?? new TopCustomersReportExporter();

    this.defaultExporter = customers;
    this.exporters = new Map<string, IReportExporter>([
      [rev.type, rev],
      [drivers.type, drivers],
      [customers.type, customers],
    ]);
  }

  /**
   * Returns the exporter for the requested analytics report type.
   * Falls back to `top_customers` for unknown types to preserve exact legacy behavior.
   */
  getExporter(type: string): IReportExporter {
    return this.exporters.get(type) ?? this.defaultExporter;
  }

  getSupportedTypes(): AnalyticsReportType[] {
    return Array.from(this.exporters.keys()) as AnalyticsReportType[];
  }
}
