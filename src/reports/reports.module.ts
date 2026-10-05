import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Order } from '../entities/order.entity';
import { Shift } from '../entities/shift.entity';
import { Driver } from '../entities/driver.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Shift, Driver])],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
