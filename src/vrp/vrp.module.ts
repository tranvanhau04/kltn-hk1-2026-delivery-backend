import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VrpController } from './vrp.controller';
import { VrpService } from './vrp.service';
import { GraphService } from './graph.service';
import { MaxFlowService } from './max-flow.service';
import { Order } from '../entities/order.entity';
import { Driver } from '../entities/driver.entity';
import { Depot } from '../entities/depot.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { User } from '../entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Driver, Depot, Route, Stop, User])],
  controllers: [VrpController],
  providers: [VrpService, GraphService, MaxFlowService],
})
export class VrpModule {}
