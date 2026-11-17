import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { Order } from '../entities/order.entity';
import { Driver } from '../entities/driver.entity';
import { Depot } from '../entities/depot.entity';
import { User } from '../entities/user.entity';
import { OrderStatusHistory } from '../entities/order-status-history.entity';
import { ProofOfDelivery } from '../entities/proof-of-delivery.entity';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Route,
      Stop,
      Order,
      Driver,
      Depot,
      User,
      OrderStatusHistory,
      ProofOfDelivery,
    ]),
    TrackingModule,
  ],
  controllers: [RoutesController],
  providers: [RoutesService],
  exports: [RoutesService],
})
export class RoutesModule {}
