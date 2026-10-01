import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { Shift } from '../entities/shift.entity';
import { Driver } from '../entities/driver.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { Depot } from '../entities/depot.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Shift, Driver, Route, Stop, Depot])],
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class ShiftsModule {}
