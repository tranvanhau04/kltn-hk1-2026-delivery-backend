import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StopsController } from './stops.controller';
import { StopsService } from './stops.service';
import { Stop } from '../entities/stop.entity';
import { Route } from '../entities/route.entity';
import { Order } from '../entities/order.entity';
import { Shift } from '../entities/shift.entity';
import { ProofOfDelivery } from '../entities/proof-of-delivery.entity';
import { OrderStatusHistory } from '../entities/order-status-history.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Stop, Route, Order, Shift, ProofOfDelivery, OrderStatusHistory]),
  ],
  controllers: [StopsController],
  providers: [StopsService],
  exports: [StopsService],
})
export class StopsModule {}
