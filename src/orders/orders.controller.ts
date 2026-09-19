import { Controller, Get, Patch, Param, Body, Post, UseInterceptors, UploadedFile, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OrdersService } from './orders.service';
import { UpdateCoordinatesDto } from './dto/update-coordinates.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { Order } from '../entities/order.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../entities/user.entity';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** GET /api/orders — all orders */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  findAll(@Query() query: QueryOrderDto) {
    return this.ordersService.findAll(query);
  }

  /** GET /api/orders/pool — unassigned NEW orders for VRP */
  @Get('pool')
  @Roles(UserRole.ADMIN)
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

  /**
   * POST /api/orders/import-excel
   * Upload an excel file to bulk import orders.
   */
  @Post('import-excel')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @UseInterceptors(FileInterceptor('file'))
  importExcel(@UploadedFile() file: Express.Multer.File) {
    return this.ordersService.importExcel(file);
  }
}
