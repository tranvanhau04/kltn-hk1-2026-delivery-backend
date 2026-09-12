import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Depot } from '../entities/depot.entity';
import { Order } from '../entities/order.entity';
import { Driver } from '../entities/driver.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { TrackingLog } from '../entities/tracking-log.entity';
import { User } from '../entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: '127.0.0.1',
      port: 3308,
      username: 'root',
      password: 'sapassword',
      database: 'delivery_db',
      entities: [Depot, Order, Driver, Route, Stop, TrackingLog, User],
      synchronize: false, // schema already created by init.sql
      logging: false,
      charset: 'utf8mb4_unicode_ci',
      extra: {
        charset: 'utf8mb4_unicode_ci',
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
