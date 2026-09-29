import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import * as crypto from 'crypto';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { Order, OrderStatus } from '../entities/order.entity';
import { Driver } from '../entities/driver.entity';
import { Depot } from '../entities/depot.entity';
import { User } from '../entities/user.entity';
import { OrderStatusHistory } from '../entities/order-status-history.entity';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface ConfirmStopDto {
  orderId: string;
  sequenceNo: number;
  /** Estimated arrival time in minutes-from-midnight (optional, informational) */
  estimatedArrivalMin?: number | null;
  latitude?: number;
  longitude?: number;
}

export interface ConfirmRouteDto {
  depotId: string;
  driverId: string;
  stops: ConfirmStopDto[];
  totalDistanceKm: number;
  totalEstimatedTimeMin: number;
  totalWeightKg?: number;
  totalVolumeM3?: number;
  polyline: [number, number][];
}

export interface ConfirmRoutesDto {
  routes: ConfirmRouteDto[];
}

export interface ConfirmedRouteResult {
  routeId: string;
  routeCode: string;
  driverId: string;
  stopCount: number;
}

export interface ConfirmRoutesResult {
  message: string;
  routeIds: string[];
  routes: ConfirmedRouteResult[];
}

// ─── Query DTOs ───────────────────────────────────────────────────────────────

export interface QueryRoutesDto {
  driverId?: string;
  status?: string;
  date?: string;
  page?: number;
  limit?: number;
}

// ─── RoutesService ────────────────────────────────────────────────────────────

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Route) private readonly routeRepo: Repository<Route>,
    @InjectRepository(Stop) private readonly stopRepo: Repository<Stop>,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(Driver) private readonly driverRepo: Repository<Driver>,
    @InjectRepository(Depot) private readonly depotRepo: Repository<Depot>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(OrderStatusHistory)
    private readonly historyRepo: Repository<OrderStatusHistory>,
  ) {}

  /**
   * Confirms a list of VRP-optimized routes in a SINGLE atomic transaction.
   *
   * Transactional flow per route:
   *   1. Validate depot + driver exist
   *   2. Validate all order IDs exist and are in NEW status
   *   3. INSERT into routes
   *   4. INSERT into stops (with sequence_no enforcement)
   *   5. Bulk UPDATE orders.status → ASSIGNED
   *   6. INSERT order_status_histories audit rows
   *   7. UPDATE driver.current_shift_status → BUSY
   *
   * Any failure in any step rolls back the entire transaction.
   *
   * @param dto - The confirm payload
   * @param dispatcherId - JWT sub (user id) of the dispatcher performing the confirm
   */
  async confirmRoutes(dto: ConfirmRoutesDto, dispatcherId?: string): Promise<ConfirmRoutesResult> {
    if (!dto.routes || dto.routes.length === 0) {
      throw new BadRequestException('No routes provided to confirm');
    }

    const today = new Date().toISOString().split('T')[0];
    const confirmedRoutes: ConfirmedRouteResult[] = [];
    const routeIds: string[] = [];

    // ── Pre-validate all input outside the transaction to give clear errors ──

    // Collect all order IDs across all routes
    const allOrderIds = dto.routes.flatMap((r) => r.stops.map((s) => s.orderId));
    const uniqueOrderIds = [...new Set(allOrderIds)];

    if (uniqueOrderIds.length !== allOrderIds.length) {
      const counts: Record<string, number> = {};
      for (const id of allOrderIds) counts[id] = (counts[id] ?? 0) + 1;
      const dups = Object.entries(counts)
        .filter(([, c]) => c > 1)
        .map(([id]) => id);
      throw new ConflictException(`Duplicate order IDs across routes: ${dups.join(', ')}`);
    }

    const existingOrders = await this.orderRepo.find({
      where: { id: In(uniqueOrderIds) },
    });
    const orderMap = new Map(existingOrders.map((o) => [o.id, o]));

    // Check for missing order IDs
    const missingIds = uniqueOrderIds.filter((id) => !orderMap.has(id));
    if (missingIds.length > 0) {
      throw new NotFoundException(`Order IDs not found: ${missingIds.join(', ')}`);
    }

    // Check for orders already assigned
    const alreadyAssigned = existingOrders.filter((o) => o.status !== OrderStatus.NEW);
    if (alreadyAssigned.length > 0) {
      const summary = alreadyAssigned.map((o) => `${o.code} (${o.status})`).join(', ');
      throw new ConflictException(
        `These orders are not in NEW status and cannot be re-assigned: ${summary}`,
      );
    }

    // Validate depots and drivers
    for (const r of dto.routes) {
      const depot = await this.depotRepo.findOne({ where: { id: r.depotId } });
      if (!depot) throw new NotFoundException(`Depot not found: ${r.depotId}`);

      const driver = await this.driverRepo.findOne({ where: { userId: r.driverId } });
      if (!driver) throw new NotFoundException(`Driver not found: ${r.driverId}`);
    }

    // ── Execute all inserts in a single atomic transaction ──────────────────

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (const r of dto.routes) {
        const routeId = crypto.randomUUID();
        const routeCode = this.generateRouteCode();

        // 3. INSERT route
        await queryRunner.manager.insert(Route, {
          id: routeId,
          depotId: r.depotId,
          driverId: r.driverId,
          routeDate: today,
          totalDistanceKm: r.totalDistanceKm,
          totalEstimatedTimeMin: r.totalEstimatedTimeMin,
          status: 'PLANNED',
          dispatcherId: dispatcherId ?? null,
          shiftId: null,
          polyline: JSON.stringify(r.polyline),
        });

        this.logger.log(
          `Transaction: inserted route ${routeCode} (${routeId}) for driver ${r.driverId}`,
        );

        // Fetch driver user info for audit note
        const driverUser = await queryRunner.manager.findOne(User, {
          where: { id: r.driverId },
        });
        const driverName = driverUser?.fullName ?? r.driverId;

        // 4. INSERT stops in sequence order
        const sortedStops = [...r.stops].sort((a, b) => a.sequenceNo - b.sequenceNo);
        for (const s of sortedStops) {
          const stopId = crypto.randomUUID();
          await queryRunner.manager.insert(Stop, {
            id: stopId,
            routeId,
            orderId: s.orderId,
            sequenceNo: s.sequenceNo,
            status: 'PENDING',
            arrivedAt: null,
          });
        }

        // 5. Bulk UPDATE orders status → ASSIGNED
        const routeOrderIds = r.stops.map((s) => s.orderId);
        await queryRunner.manager.update(
          Order,
          { id: In(routeOrderIds) },
          { status: OrderStatus.ASSIGNED, updatedAt: new Date() },
        );

        // 6. INSERT audit log per order
        for (const orderId of routeOrderIds) {
          await queryRunner.manager.insert(OrderStatusHistory, {
            orderId,
            status: OrderStatus.ASSIGNED,
            note: `Assigned to route ${routeCode} for driver ${driverName}`,
          });
        }

        // 7. UPDATE driver shift status → BUSY
        await queryRunner.manager.update(
          Driver,
          { userId: r.driverId },
          { currentShiftStatus: 'BUSY' },
        );

        routeIds.push(routeId);
        confirmedRoutes.push({
          routeId,
          routeCode,
          driverId: r.driverId,
          stopCount: r.stops.length,
        });
      }

      await queryRunner.commitTransaction();
      this.logger.log(
        `Confirmed ${confirmedRoutes.length} routes with ${allOrderIds.length} orders assigned`,
      );
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Route confirmation ROLLED BACK: ${(err as Error).message}`);
      throw err;
    } finally {
      await queryRunner.release();
    }

    return {
      message: `${confirmedRoutes.length} route(s) confirmed and dispatched successfully`,
      routeIds,
      routes: confirmedRoutes,
    };
  }

  // ─── GET /routes ────────────────────────────────────────────────────────────

  /**
   * List routes with optional filters: driverId, status, date.
   * Returns route with driver user info (name, phone) and stop count.
   */
  async findAll(query: QueryRoutesDto): Promise<{
    data: object[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { driverId, status, date, page = 1, limit = 20 } = query;

    const qb = this.routeRepo.createQueryBuilder('route');

    if (driverId) qb.andWhere('route.driverId = :driverId', { driverId });
    if (status) qb.andWhere('route.status = :status', { status });
    if (date) qb.andWhere('route.routeDate = :date', { date });

    qb.orderBy('route.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [routes, total] = await qb.getManyAndCount();

    // Enrich with driver info and stop counts
    const data = await Promise.all(
      routes.map(async (route) => {
        const [driverUser, stopCount] = await Promise.all([
          this.userRepo.findOne({ where: { id: route.driverId } }),
          this.stopRepo.count({ where: { routeId: route.id } }),
        ]);

        let polyline: [number, number][] = [];
        if (route.polyline) {
          try {
            polyline = JSON.parse(route.polyline) as [number, number][];
          } catch {
            polyline = [];
          }
        }

        return {
          id: route.id,
          depotId: route.depotId,
          driverId: route.driverId,
          driverName: driverUser?.fullName ?? 'Unknown',
          driverPhone: driverUser?.phone ?? '',
          routeDate: route.routeDate,
          totalDistanceKm: Number(route.totalDistanceKm),
          totalEstimatedTimeMin: Number(route.totalEstimatedTimeMin),
          status: route.status,
          stopCount,
          polyline,
          createdAt: route.createdAt,
        };
      }),
    );

    return { data, total, page, limit };
  }

  // ─── GET /routes/:id ────────────────────────────────────────────────────────

  /**
   * Get full route detail: stops in sequence order, driver profile, order details.
   */
  async findById(id: string): Promise<object> {
    const route = await this.routeRepo.findOne({ where: { id } });
    if (!route) throw new NotFoundException(`Route not found: ${id}`);

    const [stops, driverUser, driver, depot] = await Promise.all([
      this.stopRepo.find({ where: { routeId: id }, order: { sequenceNo: 'ASC' } }),
      this.userRepo.findOne({ where: { id: route.driverId } }),
      this.driverRepo.findOne({ where: { userId: route.driverId } }),
      this.depotRepo.findOne({ where: { id: route.depotId } }),
    ]);

    let polyline: [number, number][] = [];
    if (route.polyline) {
      try {
        polyline = JSON.parse(route.polyline) as [number, number][];
      } catch {
        polyline = [];
      }
    }

    return {
      id: route.id,
      routeDate: route.routeDate,
      status: route.status,
      totalDistanceKm: Number(route.totalDistanceKm),
      totalEstimatedTimeMin: Number(route.totalEstimatedTimeMin),
      polyline,
      createdAt: route.createdAt,
      depot: depot
        ? {
            id: depot.id,
            name: depot.name,
            address: depot.address,
            latitude: Number(depot.latitude),
            longitude: Number(depot.longitude),
          }
        : null,
      driver: {
        userId: route.driverId,
        fullName: driverUser?.fullName ?? 'Unknown',
        phone: driverUser?.phone ?? '',
        email: driverUser?.email ?? '',
        licensePlate: driver?.licensePlate ?? '',
        vehicleType: driver?.vehicleType ?? '',
        currentShiftStatus: driver?.currentShiftStatus ?? '',
      },
      stops: stops.map((s) => ({
        id: s.id,
        sequenceNo: s.sequenceNo,
        orderId: s.orderId,
        status: s.status,
        arrivedAt: s.arrivedAt,
        order: s.order
          ? {
              id: s.order.id,
              code: s.order.code,
              receiverName: s.order.receiverName,
              receiverPhone: s.order.receiverPhone,
              deliveryAddress: s.order.deliveryAddress,
              latitude: Number(s.order.latitude),
              longitude: Number(s.order.longitude),
              weightKg: Number(s.order.weightKg),
              volumeM3: Number(s.order.volumeM3),
              codAmount: Number(s.order.codAmount),
              status: s.order.status,
            }
          : null,
      })),
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private generateRouteCode(): string {
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `ROT-${dateStr}-${suffix}`;
  }
}
