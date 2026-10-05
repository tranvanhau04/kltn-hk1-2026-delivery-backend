import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { DepotsModule } from './depots/depots.module';
import { OrdersModule } from './orders/orders.module';
import { VrpModule } from './vrp/vrp.module';
import { RoutesModule } from './routes/routes.module';
import { TrackingModule } from './tracking/tracking.module';
import { ZonesModule } from './zones/zones.module';
import { DriversModule } from './drivers/drivers.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ShiftsModule } from './shifts/shifts.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    UsersModule,
    DatabaseModule,
    DepotsModule,
    OrdersModule,
    VrpModule,
    RoutesModule,
    TrackingModule,
    ZonesModule,
    DriversModule,
    ShiftsModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
