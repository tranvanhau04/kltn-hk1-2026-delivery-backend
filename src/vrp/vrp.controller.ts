import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  Query,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { VrpService } from './vrp.service';
import type { VrpSolutionResult } from './vrp.service';
import { RoutesService } from '../routes/routes.service';
import type { ConfirmRoutesDto, QueryRoutesDto } from '../routes/routes.service';
import { Order, OrderStatus } from '../entities/order.entity';
import { Driver } from '../entities/driver.entity';
import { Depot } from '../entities/depot.entity';
import { User, UserRole } from '../entities/user.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

interface OptimizeDto {
  depotId?: string;
  orderIds?: string[];
  driverIds?: string[];
}

/**
 * VRP Controller — exposes the VRP optimization + confirmation workflow.
 *
 * POST /vrp/optimize → Run the CVRP+VRPTW solver
 * POST /vrp/confirm  → Confirm & persist optimized routes (atomic transaction)
 * GET  /vrp/routes   → Proxy to RoutesService.findAll
 * GET  /vrp/routes/:id → Proxy to RoutesService.findById
 */
@Controller('vrp')
export class VrpController {
  private readonly logger = new Logger(VrpController.name);

  constructor(
    private readonly vrpService: VrpService,
    private readonly routesService: RoutesService,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(Driver) private readonly driverRepo: Repository<Driver>,
    @InjectRepository(Depot) private readonly depotRepo: Repository<Depot>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  /**
   * POST /vrp/optimize
   * Runs the CVRP + 2-opt + VRPTW solver.
   * Returns proposed routes WITHOUT persisting to the database.
   *
   * Requires: DISPATCHER or ADMIN role.
   */
  @Post('optimize')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DISPATCHER, UserRole.ADMIN)
  async optimize(
    @Body() dto: OptimizeDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<VrpSolutionResult> {
    const depot = dto.depotId
      ? await this.depotRepo.findOneOrFail({ where: { id: dto.depotId } })
      : await this.depotRepo.findOne({ where: {} });

    if (!depot) throw new Error('No depot configured');

    const orders = await this.orderRepo.find({
      where: dto.orderIds?.length
        ? { id: In(dto.orderIds) }
        : { status: OrderStatus.NEW },
    });

    const driversRaw = await this.driverRepo.find(
      dto.driverIds?.length ? { where: { userId: In(dto.driverIds) } } : {},
    );

    const userIds = driversRaw.map((d) => d.userId);
    const users = userIds.length
      ? await this.userRepo.find({ where: { id: In(userIds) } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const drivers = driversRaw
      .filter((d) => d.currentShiftStatus !== 'OFFLINE')
      .map((d) => {
        const u = userMap.get(d.userId);
        return {
          userId: d.userId,
          fullName: u?.fullName ?? 'Unknown Driver',
          phone: u?.phone ?? '',
          licensePlate: d.licensePlate,
          vehicleType: d.vehicleType,
          maxWeightKg: Number(d.maxWeightKg),
          maxVolumeM3: Number(d.maxVolumeM3),
        };
      });

    this.logger.log(
      `Optimize request: dispatcher=${user?.sub}, orders=${orders.length}, drivers=${drivers.length}`,
    );

    return this.vrpService.solve(
      {
        id: depot.id,
        name: depot.name,
        latitude: Number(depot.latitude),
        longitude: Number(depot.longitude),
      },
      orders.map((o) => ({
        id: o.id,
        code: o.code,
        receiverName: o.receiverName,
        receiverPhone: o.receiverPhone,
        deliveryAddress: o.deliveryAddress,
        latitude: Number(o.latitude),
        longitude: Number(o.longitude),
        weightKg: Number(o.weightKg),
        volumeM3: Number(o.volumeM3),
        codAmount: Number(o.codAmount),
        timeWindowStart: (o as any).timeWindowStart ?? undefined,
        timeWindowEnd: (o as any).timeWindowEnd ?? undefined,
      })),
      drivers,
    );
  }

  /**
   * POST /vrp/confirm
   * Confirms and persists proposed routes in a single atomic transaction.
   *
   * Requires: DISPATCHER or ADMIN role.
   */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DISPATCHER, UserRole.ADMIN)
  async confirm(
    @Body() dto: ConfirmRoutesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    this.logger.log(
      `Confirm request: dispatcher=${user?.sub}, routes=${dto.routes?.length ?? 0}`,
    );
    return this.routesService.confirmRoutes(dto, user?.sub);
  }

  /**
   * GET /vrp/routes
   * List all routes (proxy to RoutesService).
   */
  @Get('routes')
  async listRoutes(@Query() query: QueryRoutesDto) {
    return this.routesService.findAll(query);
  }

  /**
   * GET /vrp/routes/:id
   * Get route detail (proxy to RoutesService).
   */
  @Get('routes/:id')
  async getRoute(
    @Param('id', new ParseUUIDPipe({ version: '4', optional: true })) id: string,
  ) {
    return this.routesService.findById(id);
  }
}
