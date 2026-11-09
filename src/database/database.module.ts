import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Region } from '../entities/region.entity';
import { Depot } from '../entities/depot.entity';
import { Order } from '../entities/order.entity';
import { Driver } from '../entities/driver.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { TrackingLog } from '../entities/tracking-log.entity';
import { User } from '../entities/user.entity';
import { Zone } from '../entities/zone.entity';
import { ZoneDriver } from '../entities/zone-driver.entity';
import { PasswordReset } from '../entities/password-reset.entity';
import { OrderStatusHistory } from '../entities/order-status-history.entity';
import { Shift } from '../entities/shift.entity';
import { ProofOfDelivery } from '../entities/proof-of-delivery.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST || '127.0.0.1',
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3308,
      username: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'sapassword',
      database: process.env.DB_NAME || 'delivery_db',
      entities: [
        Region,
        Depot,
        Order,
        Driver,
        Route,
        Stop,
        TrackingLog,
        User,
        Zone,
        ZoneDriver,
        PasswordReset,
        OrderStatusHistory,
        Shift,
        ProofOfDelivery,
      ],
      synchronize: false, // schema already created by init.sql
      logging: false,
      charset: 'utf8mb4_unicode_ci',
      timezone: 'Z',
      extra: {
        charset: 'utf8mb4_unicode_ci',
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
