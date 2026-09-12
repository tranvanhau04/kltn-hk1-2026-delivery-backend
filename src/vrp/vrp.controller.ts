import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { VrpService, VrpSolutionResult } from './vrp.service';
import { Order } from '../entities/order.entity';
import { Driver } from '../entities/driver.entity';
import { Depot } from '../entities/depot.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { User } from '../entities/user.entity';
import { v4 as uuidv4 } from 'uuid';

interface OptimizeDto {
  depotId?: string;
  orderIds: string[];
  driverIds?: string[];
}

interface ConfirmRouteDto {
  depotId: string;
  driverId: string;
  stops: Array<{
    orderId: string;
    sequenceNo: number;
    latitude: number;
    longitude: number;
  }>;
  totalDistanceKm: number;
  totalEstimatedTimeMin: number;
  polyline: [number, number][];
}

interface ConfirmDto {
  routes: ConfirmRouteDto[];
}

@Controller('vrp')
export class VrpController {
  constructor(
    private readonly vrpService: VrpService,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(Driver) private readonly driverRepo: Repository<Driver>,
    @InjectRepository(Depot) private readonly depotRepo: Repository<Depot>,
    @InjectRepository(Route) private readonly routeRepo: Repository<Route>,
    @InjectRepository(Stop) private readonly stopRepo: Repository<Stop>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  @Post('optimize')
  @HttpCode(HttpStatus.OK)
  async optimize(@Body() dto: OptimizeDto): Promise<VrpSolutionResult> {
    // Load depot (first if not specified)
    const depot = dto.depotId
      ? await this.depotRepo.findOneOrFail({ where: { id: dto.depotId } })
      : await this.depotRepo.findOne({ where: {} });

    if (!depot) throw new Error('No depot found');

    // Load orders
    const orders = await this.orderRepo.find({
      where: dto.orderIds?.length ? { id: In(dto.orderIds) } : { status: 'NEW' },
    });

    // Load drivers with user info
    const driversRaw = await this.driverRepo.find(
      dto.driverIds?.length ? { where: { userId: In(dto.driverIds) } } : {},
    );

    // Fetch user info to get full names
    const userIds = driversRaw.map((d) => d.userId);
    const users = userIds.length ? await this.userRepo.find({ where: { id: In(userIds) } }) : [];
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

    return await this.vrpService.solve(
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
      })),
      drivers,
    );
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@Body() dto: ConfirmDto): Promise<{ message: string; routeIds: string[] }> {
    const today = new Date().toISOString().split('T')[0];
    const routeIds: string[] = [];

    for (const r of dto.routes) {
      const routeId = uuidv4();
      routeIds.push(routeId);

      // Serialize polyline as JSON string
      const polylineJson = JSON.stringify(r.polyline);

      const route = this.routeRepo.create({
        id: routeId,
        depotId: r.depotId,
        driverId: r.driverId,
        routeDate: today,
        totalDistanceKm: r.totalDistanceKm,
        totalEstimatedTimeMin: r.totalEstimatedTimeMin,
        status: 'PLANNED',
        polyline: polylineJson,
      });
      await this.routeRepo.save(route);

      // Create stops
      for (const s of r.stops) {
        const stop = this.stopRepo.create({
          id: uuidv4(),
          routeId,
          orderId: s.orderId,
          sequenceNo: s.sequenceNo,
          status: 'PENDING',
          arrivedAt: null,
        });
        await this.stopRepo.save(stop);

        // Update order status to ASSIGNED
        await this.orderRepo.update(s.orderId, { status: 'ASSIGNED' });
      }
    }

    return { message: 'Routes confirmed and dispatched', routeIds };
  }
}
