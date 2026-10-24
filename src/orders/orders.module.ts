import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { Order } from '../entities/order.entity';
import { Depot } from '../entities/depot.entity';
import { OrderStatusHistory } from '../entities/order-status-history.entity';
import { Stop } from '../entities/stop.entity';
import { ProofOfDelivery } from '../entities/proof-of-delivery.entity';
import { GeocodingService } from '../geocoding/geocoding.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Depot, OrderStatusHistory, Stop, ProofOfDelivery])],
  controllers: [OrdersController],
  providers: [OrdersService, GeocodingService],
  exports: [OrdersService, GeocodingService],
})
export class OrdersModule {}
