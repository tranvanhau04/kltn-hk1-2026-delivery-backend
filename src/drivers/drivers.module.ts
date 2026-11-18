import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Driver } from '../entities/driver.entity';
import { User } from '../entities/user.entity';
import { Depot } from '../entities/depot.entity';
import { Zone } from '../entities/zone.entity';
import { ZoneDriver } from '../entities/zone-driver.entity';
import { Order } from '../entities/order.entity';
import { Shift } from '../entities/shift.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Driver, User, Depot, Zone, ZoneDriver, Order, Shift, Route, Stop]),
  ],
  controllers: [DriversController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}
