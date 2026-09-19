import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../entities/user.entity';

@Controller('orders')
export class OrdersController {
  constructor(@InjectRepository(Order) private readonly orderRepo: Repository<Order>) {}

  /** Returns all unassigned (NEW) orders waiting for VRP assignment */
  @Get('pool')
  @Roles(UserRole.ADMIN)
  findPool(): Promise<Order[]> {
    return this.orderRepo.find({ where: { status: 'NEW' } });
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  findAll(): Promise<Order[]> {
    return this.orderRepo.find();
  }
}
