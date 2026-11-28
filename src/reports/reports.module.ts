import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Order } from '../entities/order.entity';
import { Shift } from '../entities/shift.entity';
import { Driver } from '../entities/driver.entity';
import { User } from '../entities/user.entity';
import { S3Module } from '../s3/s3.module';
import { RevenueReportExporter } from './exporters/revenue-report.exporter';
import { TopDriversReportExporter } from './exporters/top-drivers-report.exporter';
import { TopCustomersReportExporter } from './exporters/top-customers-report.exporter';
import { ReportExporterFactory } from './exporters/report-exporter.factory';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Shift, Driver, User]), S3Module],
  controllers: [ReportsController],
  providers: [
    RevenueReportExporter,
    TopDriversReportExporter,
    TopCustomersReportExporter,
    ReportExporterFactory,
    ReportsService,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
