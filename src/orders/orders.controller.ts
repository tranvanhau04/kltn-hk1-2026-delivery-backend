import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { UpdateCoordinatesDto } from './dto/update-coordinates.dto';
import { Order } from '../entities/order.entity';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** GET /api/orders — all orders */
  @Get()
  findAll(): Promise<Order[]> {
    return this.ordersService.findAll();
  }

  /** GET /api/orders/pool — unassigned NEW orders for VRP */
  @Get('pool')
  findPool(): Promise<Order[]> {
    return this.ordersService.findPool();
  }

  /** GET /api/orders/:id — single order detail */
  @Get(':id')
  findOne(@Param('id') id: string): Promise<Order> {
    return this.ordersService.findById(id);
  }

  /**
   * PATCH /api/orders/:id/coordinates
   * Allows a Dispatcher to manually adjust delivery coordinates.
   * Blocked if order status is DELIVERED.
   */
  @Patch(':id/coordinates')
  updateCoordinates(
    @Param('id') id: string,
    @Body() dto: UpdateCoordinatesDto,
  ): Promise<Order> {
    return this.ordersService.updateCoordinates(id, dto);
  }
}
