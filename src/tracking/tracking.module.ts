import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackingController } from './tracking.controller';
import { TrackingGateway } from './tracking.gateway';
import { WsThrottlerGuard } from './guards/ws-throttler.guard';
import { TrackingLog } from '../entities/tracking-log.entity';
import { Shift } from '../entities/shift.entity';
import { Driver } from '../entities/driver.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { User } from '../entities/user.entity';
import { AuthModule } from '../auth/auth.module';

/**
 * TrackingModule — Manages GPS tracking via REST (TrackingController)
 * and real-time WebSocket events (TrackingGateway).
 *
 * Task 9.2: Imports AuthModule to share JwtService for socket authentication.
 * Task 12.1: Provides WsThrottlerGuard for WebSocket rate limiting.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TrackingLog, Shift, Driver, Route, Stop, User]),
    AuthModule, // provides JwtService for TrackingGateway JWT verification
  ],
  controllers: [TrackingController],
  providers: [TrackingGateway, WsThrottlerGuard],
  exports: [TrackingGateway, WsThrottlerGuard],
})
export class TrackingModule {}
