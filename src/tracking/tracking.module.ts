import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackingController } from './tracking.controller';
import { TrackingLog } from '../entities/tracking-log.entity';
import { Driver } from '../entities/driver.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { User } from '../entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TrackingLog, Driver, Route, Stop, User])],
  controllers: [TrackingController],
})
export class TrackingModule {}
