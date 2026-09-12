import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { DepotsModule } from './depots/depots.module';
import { OrdersModule } from './orders/orders.module';
import { VrpModule } from './vrp/vrp.module';
import { TrackingModule } from './tracking/tracking.module';

@Module({
  imports: [DatabaseModule, DepotsModule, OrdersModule, VrpModule, TrackingModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
