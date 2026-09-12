import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../entities/order.entity';

@Controller('orders')
export class OrdersController {
  constructor(@InjectRepository(Order) private readonly orderRepo: Repository<Order>) {}

  /** Returns all unassigned (NEW) orders waiting for VRP assignment */
  @Get('pool')
  findPool(): Promise<Order[]> {
    return this.orderRepo.find({ where: { status: 'NEW' } });
  }

  @Get()
  findAll(): Promise<Order[]> {
    return this.orderRepo.find();
  }
}
