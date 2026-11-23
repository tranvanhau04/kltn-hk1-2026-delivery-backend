import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsModule } from '../reports/reports.module';
import { AiAnalystController } from './ai-analyst.controller';
import { AiAnalystService } from './ai-analyst.service';
import { Order } from '../entities/order.entity';
import { Shift } from '../entities/shift.entity';
import { Driver } from '../entities/driver.entity';
import { User } from '../entities/user.entity';
import { ProofOfDelivery } from '../entities/proof-of-delivery.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Shift, Driver, User, ProofOfDelivery]), ReportsModule],
  controllers: [AiAnalystController],
  providers: [AiAnalystService],
  exports: [AiAnalystService],
})
export class AiAnalystModule {}
