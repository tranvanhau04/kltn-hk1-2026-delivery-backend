import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VrpController } from './vrp.controller';
import { VrpService } from './vrp.service';
import { GraphService } from './graph.service';
import { MaxFlowService } from './max-flow.service';
import { RoutesModule } from '../routes/routes.module';
import { Order } from '../entities/order.entity';
import { Driver } from '../entities/driver.entity';
import { Depot } from '../entities/depot.entity';
import { User } from '../entities/user.entity';
import { Zone } from '../entities/zone.entity';
import { ZoneDriver } from '../entities/zone-driver.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, Driver, Depot, User, Zone, ZoneDriver]),
    RoutesModule,
  ],
  controllers: [VrpController],
  providers: [VrpService, GraphService, MaxFlowService],
})
export class VrpModule {}
