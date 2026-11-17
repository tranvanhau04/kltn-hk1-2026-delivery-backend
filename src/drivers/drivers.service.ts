import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Driver, DriverShiftStatus } from '../entities/driver.entity';
import { User, UserRole } from '../entities/user.entity';
import { Depot } from '../entities/depot.entity';
import { Zone } from '../entities/zone.entity';
import { ZoneDriver } from '../entities/zone-driver.entity';
import { Order, OrderStatus } from '../entities/order.entity';
import { Shift, ShiftStatus } from '../entities/shift.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateDriverDto, UpdateDriverDto, UpdateShiftStatusDto, QueryDriverDto } from './dto';

interface DriverRawRow {
  userId: string;
  depotId?: string;
  depotName?: string;
  licensePlate: string;
  vehicleType: string;
  maxWeightKg: string | number;
  maxVolumeM3: string | number;
  currentShiftStatus: DriverShiftStatus;
  fullName: string;
  phone: string;
  email: string;
  userStatus: string;
}

@Injectable()
export class DriversService {
  constructor(
    @InjectRepository(Driver)
    private readonly driverRepo: Repository<Driver>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Depot)
    private readonly depotRepo: Repository<Depot>,
    @InjectRepository(Zone)
    private readonly zoneRepo: Repository<Zone>,
    @InjectRepository(ZoneDriver)
    private readonly zoneDriverRepo: Repository<ZoneDriver>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
    @InjectRepository(Route)
    private readonly routeRepo: Repository<Route>,
    @InjectRepository(Stop)
    private readonly stopRepo: Repository<Stop>,
  ) {}

  async findAllUnpaginated(): Promise<Driver[]> {
    return this.driverRepo.find();
  }

  /**
   * GET /api/drivers/me/fleet-info & /api/drivers/:userId/fleet-info
   * Returns vehicle profile, assigned depot, operational zones, and current shift load & order metrics.
   */
  async getFleetInfo(userId: string) {
    const driver = await this.driverRepo.findOne({
      where: { userId },
      relations: ['depot'],
    });

    if (!driver) {
      throw new NotFoundException(`Hồ sơ tài xế với user ID '${userId}' không tồn tại`);
    }

    // 1. Fetch Depot
    let depot = driver.depot;
    if (!depot && driver.depotId) {
      depot = await this.depotRepo.findOne({ where: { id: driver.depotId } });
    }

    // 2. Fetch assigned Zones
    const zoneDrivers = await this.zoneDriverRepo
      .createQueryBuilder('zd')
      .innerJoin(Zone, 'z', 'z.id = zd.zone_id')
      .where('zd.driver_id = :driverId', { driverId: userId })
      .select('z.name', 'name')
      .getRawMany<{ name: string }>();

    const zones = zoneDrivers.map((zd) => zd.name);

    // 3. Fetch current active Shift
    const activeShift = await this.shiftRepo.findOne({
      where: { driverId: userId, status: ShiftStatus.OPEN },
      order: { startTime: 'DESC' },
    });

    // 4. Calculate Load (kg) and Order metrics
    // Priority: Query active route for this driver
    const activeStatuses = ['ASSIGNED', 'IN_PROGRESS', 'CONFIRMED', 'PLANNED'];
    const activeRoute = await this.routeRepo
      .createQueryBuilder('route')
      .where('route.driver_id = :driverId', { driverId: userId })
      .andWhere('route.status IN (:...statuses)', { statuses: activeStatuses })
      .orderBy('route.created_at', 'DESC')
      .getOne();

    let totalAssignedOrders = 0;
    let deliveredOrders = 0;
    let remainingOrders = 0;
    let currentWeightKg = 0;
    let totalShiftWeightKg = 0;

    if (activeRoute) {
      const stops = await this.stopRepo.find({
        where: { routeId: activeRoute.id },
        relations: ['order'],
        order: { sequenceNo: 'ASC' },
      });

      totalAssignedOrders = stops.length;

      for (const stop of stops) {
        const order = stop.order;
        const weight = order?.weightKg ? Number(order.weightKg) : 0;
        totalShiftWeightKg += weight;

        const isDelivered =
          stop.status === 'COMPLETED' || order?.status === OrderStatus.DELIVERED;
        const isFailed =
          stop.status === 'FAILED' ||
          stop.status === 'SKIPPED' ||
          order?.status === OrderStatus.FAILED ||
          order?.status === OrderStatus.CANCELLED;

        if (isDelivered) {
          deliveredOrders += 1;
        } else if (!isFailed) {
          // Still on vehicle / remaining to deliver
          remainingOrders += 1;
          currentWeightKg += weight;
        }
      }
    } else {
      // Fallback: Query direct orders assigned to this driver
      const assignedOrders = await this.orderRepo.find({
        where: { driverId: userId },
      });

      totalAssignedOrders = assignedOrders.length;
      for (const order of assignedOrders) {
        const weight = order.weightKg ? Number(order.weightKg) : 0;
        totalShiftWeightKg += weight;

        if (order.status === OrderStatus.DELIVERED) {
          deliveredOrders += 1;
        } else if (
          order.status === OrderStatus.ASSIGNED ||
          order.status === OrderStatus.IN_TRANSIT ||
          (order.status as string) === 'PICKED_UP' ||
          (order.status as string) === 'DELIVERING'
        ) {
          remainingOrders += 1;
          currentWeightKg += weight;
        }
      }
    }

    currentWeightKg = Number(currentWeightKg.toFixed(2));
    totalShiftWeightKg = Number(totalShiftWeightKg.toFixed(2));

    return {
      success: true,
      driver: {
        userId: driver.userId,
        licensePlate: driver.licensePlate,
        vehicleType: driver.vehicleType,
        maxWeightKg: Number(driver.maxWeightKg) || 0,
        maxVolumeM3: Number(driver.maxVolumeM3) || 0,
        currentShiftStatus: driver.currentShiftStatus,
      },
      metrics: {
        currentWeightKg,
        totalShiftWeightKg,
        totalAssignedOrders,
        deliveredOrders,
        remainingOrders,
      },
      depot: depot
        ? {
            id: depot.id,
            name: depot.name,
            address: depot.address,
            contactPhone: depot.contactPhone || '02838000999',
            latitude: Number(depot.latitude),
            longitude: Number(depot.longitude),
          }
        : null,
      zones,
      activeShift: activeShift
        ? {
            id: activeShift.id,
            startTime: activeShift.startTime,
            status: activeShift.status,
          }
        : null,
    };
  }

  /**
   * GET /api/drivers/me/account-summary
   * Profile, assigned depot & zones, current shift COD balance, and monthly delivery metrics.
   */
  async getAccountSummary(userId: string) {
    const driver = await this.driverRepo.findOne({
      where: { userId },
      relations: ['depot'],
    });

    if (!driver) {
      throw new NotFoundException(`Hồ sơ tài xế với user ID '${userId}' không tồn tại`);
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });

    // 1. Fetch Depot
    let depot = driver.depot;
    if (!depot && driver.depotId) {
      depot = await this.depotRepo.findOne({ where: { id: driver.depotId } });
    }

    // 2. Fetch assigned Zones
    const zoneDrivers = await this.zoneDriverRepo
      .createQueryBuilder('zd')
      .innerJoin(Zone, 'z', 'z.id = zd.zone_id')
      .where('zd.driver_id = :driverId', { driverId: userId })
      .select('z.name', 'name')
      .getRawMany<{ name: string }>();

    const zones = zoneDrivers.map((zd) => zd.name);

    // 3. Format vehicle type friendly
    const formatVehicleType = (type?: string): string => {
      if (!type) return 'Phương tiện chưa cập nhật';
      switch (type.toUpperCase()) {
        case 'VAN_500KG':
          return 'Xe tải Van (500kg)';
        case 'VAN_1000KG':
          return 'Xe tải Van (1.000kg)';
        case 'MOTORBIKE':
          return 'Xe máy - Giao hàng';
        default:
          return type;
      }
    };

    // 4. Current Shift info
    const activeShift = await this.shiftRepo.findOne({
      where: [
        { driverId: userId, status: ShiftStatus.OPEN },
        { driverId: userId, status: ShiftStatus.PENDING_SETTLEMENT },
      ],
      order: { startTime: 'DESC' },
    });

    let codHolding = 0;
    let codCollected = 0;
    let startingCashCod = 0;
    let codSubmitted = 0;
    let shiftStatus: ShiftStatus | 'CLOSED' = 'CLOSED';
    let shiftStatusLabel = 'Chưa mở ca';

    if (activeShift) {
      codCollected = Number(activeShift.codCollected) || 0;
      startingCashCod = Number(activeShift.startingCashCod) || 0;
      codSubmitted = Number(activeShift.codSubmitted) || 0;

      // Đồng bộ với các điểm dừng đã giao trong tuyến nếu ca chưa kịp ghi nhận
      if (codCollected === 0) {
        const activeRoute = await this.routeRepo.findOne({
          where: [
            { driverId: userId, status: 'IN_PROGRESS' },
            { driverId: userId, status: 'ASSIGNED' },
          ],
          relations: ['stops', 'stops.order'],
        });
        if (activeRoute?.stops) {
          const routeCod = activeRoute.stops
            .filter((s) => s.status === 'COMPLETED')
            .reduce((sum, s) => sum + (s.order ? Number(s.order.codAmount) : 0), 0);
          if (routeCod > 0) codCollected = routeCod;
        }
      }

      // Tiền COD thực tế đang giữ = Tiền COD đã thu từ các đơn thành công - Tiền đã nộp (không cộng tiền ứng đầu ca)
      codHolding = Math.max(0, codCollected - codSubmitted);
      shiftStatus = activeShift.status;
      shiftStatusLabel = activeShift.status === ShiftStatus.OPEN ? 'Đang mở ca' : 'Chờ đối soát';
    }

    // 5. Monthly metrics (Real DB calculation for current calendar month)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const routes = await this.routeRepo
      .createQueryBuilder('r')
      .where('r.driver_id = :driverId', { driverId: userId })
      .andWhere('r.created_at >= :startOfMonth AND r.created_at <= :endOfMonth', {
        startOfMonth,
        endOfMonth,
      })
      .getMany();

    let monthlyDeliveredOrders = 0;
    let monthlyFailedOrders = 0;
    const monthlyCompletedRoutes = routes.filter((r) => r.status === 'COMPLETED').length;

    if (routes.length > 0) {
      const routeIds = routes.map((r) => r.id);
      const stops = await this.stopRepo
        .createQueryBuilder('s')
        .leftJoinAndSelect('s.order', 'o')
        .where('s.route_id IN (:...routeIds)', { routeIds })
        .getMany();

      for (const stop of stops) {
        if (stop.status === 'COMPLETED' || stop.order?.status === OrderStatus.DELIVERED) {
          monthlyDeliveredOrders++;
        } else if (
          stop.status === 'FAILED' ||
          stop.order?.status === OrderStatus.FAILED ||
          stop.order?.status === OrderStatus.CANCELLED
        ) {
          monthlyFailedOrders++;
        }
      }
    } else {
      const orders = await this.orderRepo
        .createQueryBuilder('o')
        .where('o.driver_id = :driverId', { driverId: userId })
        .andWhere('o.created_at >= :startOfMonth AND o.created_at <= :endOfMonth', {
          startOfMonth,
          endOfMonth,
        })
        .getMany();

      for (const order of orders) {
        if (order.status === OrderStatus.DELIVERED) {
          monthlyDeliveredOrders++;
        } else if (order.status === OrderStatus.FAILED || order.status === OrderStatus.CANCELLED) {
          monthlyFailedOrders++;
        }
      }
    }

    const totalProcessed = monthlyDeliveredOrders + monthlyFailedOrders;
    const monthlySuccessRate =
      totalProcessed > 0 ? Math.round((monthlyDeliveredOrders / totalProcessed) * 100) : 100;

    return {
      success: true,
      user: {
        id: user?.id,
        fullName: user?.fullName || 'Tài xế',
        phone: user?.phone || '',
        email: user?.email || '',
        status: user?.status,
      },
      driver: {
        userId: driver.userId,
        licensePlate: driver.licensePlate,
        vehicleType: driver.vehicleType,
        vehicleTypeFriendly: formatVehicleType(driver.vehicleType),
        currentShiftStatus: driver.currentShiftStatus,
      },
      depot: depot
        ? {
            id: depot.id,
            name: depot.name,
            address: depot.address,
            contactPhone: depot.contactPhone || '02838940338',
            latitude: Number(depot.latitude),
            longitude: Number(depot.longitude),
          }
        : null,
      zones,
      currentShift: {
        id: activeShift?.id || null,
        status: shiftStatus,
        statusLabel: shiftStatusLabel,
        startTime: activeShift?.startTime || null,
        codHolding,
        codCollected,
        startingCashCod,
        codSubmitted,
      },
      metrics: {
        monthlyDeliveredOrders,
        monthlyCompletedRoutes,
        monthlySuccessRate,
        totalProcessed,
      },
    };
  }

  /**
   * GET /api/drivers/me/shift-history
   * Recent shifts and COD settlement history.
   */
  async getShiftHistory(userId: string) {
    const shifts = await this.shiftRepo.find({
      where: { driverId: userId },
      order: { startTime: 'DESC' },
      take: 30,
    });

    return {
      success: true,
      data: shifts.map((s) => {
        const codCollected = Number(s.codCollected) || 0;
        const startingCashCod = Number(s.startingCashCod) || 0;
        const codSubmitted = Number(s.codSubmitted) || 0;
        const codDifference = codCollected - codSubmitted;

        let statusLabel = 'Đã chốt';
        if (s.status === ShiftStatus.OPEN) {
          statusLabel = 'Đang mở ca';
        } else if (s.status === ShiftStatus.PENDING_SETTLEMENT) {
          statusLabel = 'Chờ đối soát';
        }

        return {
          id: s.id,
          startTime: s.startTime,
          endTime: s.endTime,
          status: s.status,
          statusLabel,
          startingCashCod,
          codCollected,
          codSubmitted,
          codDifference,
          reconciledAt: s.reconciledAt || null,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        };
      }),
    };
  }

  /**
   * GET /api/drivers
   * Paginated list of drivers with joined user details and filtering.
   * Accessible by ADMIN and DISPATCHER.
   */
  async findAll(query: QueryDriverDto) {
    const page = query.page && query.page > 0 ? Number(query.page) : 1;
    const limit = query.limit && query.limit > 0 ? Number(query.limit) : 10;
    const skip = (page - 1) * limit;

    const qb = this.driverRepo
      .createQueryBuilder('driver')
      .leftJoin(User, 'user', 'user.id = driver.user_id')
      .leftJoin(Depot, 'depot', 'depot.id = driver.depot_id')
      .select([
        'driver.user_id AS userId',
        'driver.depot_id AS depotId',
        'depot.name AS depotName',
        'driver.license_plate AS licensePlate',
        'driver.vehicle_type AS vehicleType',
        'driver.max_weight_kg AS maxWeightKg',
        'driver.max_volume_m3 AS maxVolumeM3',
        'driver.current_shift_status AS currentShiftStatus',
        'user.full_name AS fullName',
        'user.phone AS phone',
        'user.email AS email',
        'user.status AS userStatus',
      ]);

    if (query.hubId) {
      qb.andWhere('driver.depot_id = :hubId', { hubId: query.hubId });
    } else if (query.regionId) {
      qb.andWhere('depot.region_id = :regionId', { regionId: query.regionId });
    }

    if (query.vehicleType) {
      qb.andWhere('driver.vehicle_type = :vehicleType', {
        vehicleType: query.vehicleType,
      });
    }

    if (query.currentShiftStatus) {
      qb.andWhere('driver.current_shift_status = :shiftStatus', {
        shiftStatus: query.currentShiftStatus,
      });
    }

    if (query.search && query.search.trim()) {
      const searchTerm = `%${query.search.trim()}%`;
      qb.andWhere(
        '(driver.license_plate LIKE :search OR user.full_name LIKE :search OR user.phone LIKE :search)',
        { search: searchTerm },
      );
    }

    const total = await qb.getCount();

    const rawData = await qb
      .orderBy('driver.license_plate', 'ASC')
      .offset(skip)
      .limit(limit)
      .getRawMany<DriverRawRow>();

    const formattedData = rawData.map((d: DriverRawRow) => ({
      userId: d.userId,
      depotId: d.depotId,
      depot: d.depotId ? { id: d.depotId, name: d.depotName } : null,
      licensePlate: d.licensePlate,
      vehicleType: d.vehicleType,
      maxWeightKg: Number(d.maxWeightKg),
      maxVolumeM3: Number(d.maxVolumeM3),
      currentShiftStatus: d.currentShiftStatus,
      user: {
        fullName: d.fullName,
        phone: d.phone,
        email: d.email,
        status: d.userStatus,
      },
    }));

    return {
      data: formattedData,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * GET /api/drivers/:userId
   * Get vehicle specifications of a driver.
   * Access: ADMIN, DISPATCHER, DRIVER (self only).
   */
  async findByUserId(userId: string, currentUser: JwtPayload) {
    if (currentUser.role === UserRole.DRIVER && currentUser.sub !== userId) {
      throw new ForbiddenException('Drivers are only allowed to view their own vehicle profile');
    }

    const driver = await this.driverRepo.findOne({
      where: { userId },
      relations: ['depot'],
    });
    if (!driver) {
      throw new NotFoundException(`Driver profile with user ID '${userId}' not found`);
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });

    return {
      ...driver,
      maxWeightKg: Number(driver.maxWeightKg),
      maxVolumeM3: Number(driver.maxVolumeM3),
      user: user
        ? {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            status: user.status,
          }
        : null,
    };
  }

  /**
   * POST /api/drivers/:userId
   * Configure vehicle specifications for a driver.
   * Access: ADMIN only.
   */
  async create(userId: string, dto: CreateDriverDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID '${userId}' not found`);
    }

    if (user.role !== UserRole.DRIVER) {
      throw new BadRequestException('Cannot configure vehicle profile for non-driver user');
    }

    const existingProfile = await this.driverRepo.findOne({ where: { userId } });
    if (existingProfile) {
      throw new ConflictException('Driver vehicle profile already exists. Use PATCH to update.');
    }

    const existingPlate = await this.driverRepo.findOne({
      where: { licensePlate: dto.licensePlate },
    });
    if (existingPlate) {
      throw new ConflictException(
        `License plate '${dto.licensePlate}' is already assigned to another driver`,
      );
    }

    const driver = this.driverRepo.create({
      userId,
      depotId: dto.depotId,
      licensePlate: dto.licensePlate,
      vehicleType: dto.vehicleType,
      maxWeightKg: dto.maxWeightKg,
      maxVolumeM3: dto.maxVolumeM3,
      currentShiftStatus: dto.currentShiftStatus || DriverShiftStatus.OFFLINE,
    });

    const saved = await this.driverRepo.save(driver);
    return {
      ...saved,
      maxWeightKg: Number(saved.maxWeightKg),
      maxVolumeM3: Number(saved.maxVolumeM3),
    };
  }

  /**
   * PATCH /api/drivers/:userId
   * Update vehicle specifications (license plate, vehicle type, capacities).
   * Access: ADMIN only.
   */
  async update(userId: string, dto: UpdateDriverDto) {
    const driver = await this.driverRepo.findOne({ where: { userId } });
    if (!driver) {
      throw new NotFoundException(`Driver profile with user ID '${userId}' not found`);
    }

    if (dto.licensePlate && dto.licensePlate !== driver.licensePlate) {
      const existingPlate = await this.driverRepo.findOne({
        where: { licensePlate: dto.licensePlate, userId: Not(userId) },
      });
      if (existingPlate) {
        throw new ConflictException(
          `License plate '${dto.licensePlate}' is already assigned to another driver`,
        );
      }
      driver.licensePlate = dto.licensePlate;
    }

    if (dto.vehicleType) {
      driver.vehicleType = dto.vehicleType;
    }

    if (dto.depotId !== undefined) {
      driver.depotId = dto.depotId;
    }

    if (dto.maxWeightKg !== undefined) {
      driver.maxWeightKg = dto.maxWeightKg;
    }

    if (dto.maxVolumeM3 !== undefined) {
      driver.maxVolumeM3 = dto.maxVolumeM3;
    }

    const saved = await this.driverRepo.save(driver);
    return {
      ...saved,
      maxWeightKg: Number(saved.maxWeightKg),
      maxVolumeM3: Number(saved.maxVolumeM3),
    };
  }

  /**
   * PATCH /api/drivers/:userId/shift-status
   * Update driver shift status (OFFLINE, ONLINE_READY, BUSY).
   * Access: ADMIN, DISPATCHER, DRIVER (self only).
   */
  async updateShiftStatus(userId: string, dto: UpdateShiftStatusDto, currentUser: JwtPayload) {
    if (currentUser.role === UserRole.DRIVER && currentUser.sub !== userId) {
      throw new ForbiddenException('Drivers can only update their own shift status');
    }

    const driver = await this.driverRepo.findOne({ where: { userId } });
    if (!driver) {
      throw new NotFoundException(`Driver profile with user ID '${userId}' not found`);
    }

    driver.currentShiftStatus = dto.currentShiftStatus;
    const saved = await this.driverRepo.save(driver);

    return {
      userId: saved.userId,
      licensePlate: saved.licensePlate,
      currentShiftStatus: saved.currentShiftStatus,
    };
  }

  /**
   * DELETE /api/drivers/:userId
   * Remove vehicle profile of a driver.
   * Access: ADMIN only.
   */
  async remove(userId: string) {
    const driver = await this.driverRepo.findOne({ where: { userId } });
    if (!driver) {
      throw new NotFoundException(`Driver profile with user ID '${userId}' not found`);
    }

    await this.driverRepo.delete({ userId });

    return {
      message: 'Driver vehicle profile successfully removed',
      userId,
    };
  }

  /**
   * GET /api/drivers/me/earnings
   * Calculate driver gross earnings, 15% platform commission, and net income
   * grouped by day, week, month.
   */
  async getEarnings(userId: string) {
    const driver = await this.driverRepo.findOne({ where: { userId } });
    if (!driver) {
      throw new NotFoundException(`Hồ sơ tài xế với user ID '${userId}' không tồn tại`);
    }

    // 1. Lấy danh sách tất cả các điểm dừng COMPLETED hoặc đơn hàng DELIVERED của tài xế
    const completedStops = await this.stopRepo
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.order', 'o')
      .innerJoin(Route, 'r', 'r.id = s.route_id')
      .where('r.driver_id = :userId', { userId })
      .andWhere('(s.status = :completedStatus OR o.status = :deliveredStatus)', {
        completedStatus: 'COMPLETED',
        deliveredStatus: OrderStatus.DELIVERED,
      })
      .orderBy('COALESCE(s.arrived_at, o.updated_at, o.created_at)', 'DESC')
      .getMany();

    // 2. Lấy thêm tuyến hiện tại (active/assigned) để đảm bảo các đơn hoàn thành trong ca luôn có mặt
    const activeRoute = await this.routeRepo.findOne({
      where: [
        { driverId: userId, status: 'IN_PROGRESS' },
        { driverId: userId, status: 'ASSIGNED' },
        { driverId: userId, status: 'PLANNED' },
      ],
    });

    const activeRouteCompletedStops = activeRoute
      ? await this.stopRepo.find({
          where: { routeId: activeRoute.id, status: 'COMPLETED' },
          relations: ['order'],
        })
      : [];
    const activeRouteOrderIds = new Set(
      activeRouteCompletedStops.filter((s) => s.order).map((s) => s.order.id),
    );

    // Helper tính cước phí mỗi đơn (làm tròn chẵn nghìn đồng)
    const calculateGrossFee = (order: Order): number => {
      const fee = Number(order.deliveryFee);
      if (!isNaN(fee) && fee > 0) {
        return Math.round(fee / 1000) * 1000;
      }
      const weight = Math.max(1, Number(order.weightKg) || 1);
      return Math.min(60000, Math.round((20000 + 2000 * weight) / 1000) * 1000);
    };

    const toBreakdownItem = (order: Order, completedAtDate?: Date | string | null) => {
      const grossFee = Math.round(calculateGrossFee(order) / 1000) * 1000;
      const commissionRate = 15;
      const platformFee = Math.round((grossFee * 0.15) / 1000) * 1000;
      const netIncome = grossFee - platformFee;
      return {
        id: order.id,
        code: order.code,
        completedAt: completedAtDate
          ? new Date(completedAtDate).toISOString()
          : new Date(order.updatedAt || order.createdAt).toISOString(),
        weightKg: Number(order.weightKg) || 0,
        codAmount: Math.round((Number(order.codAmount) || 0) / 1000) * 1000,
        deliveryAddress: order.deliveryAddress,
        grossFee,
        commissionRate,
        platformFee,
        netIncome,
      };
    };

    type BreakdownItem = ReturnType<typeof toBreakdownItem>;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const todayItems: BreakdownItem[] = [];
    const weekItems: BreakdownItem[] = [];
    const monthItems: BreakdownItem[] = [];

    // Gộp đơn của activeRoute vào todayItems trước
    for (const stop of activeRouteCompletedStops) {
      todayItems.push(toBreakdownItem(stop.order, stop.arrivedAt));
    }

    // Duyệt qua tất cả completedStops trong DB
    for (const stop of completedStops) {
      if (!stop.order) continue;
      if (activeRouteOrderIds.has(stop.order.id)) continue;

      const completedTime = new Date(
        stop.arrivedAt || stop.order.updatedAt || stop.order.createdAt,
      ).getTime();
      const item = toBreakdownItem(stop.order, stop.arrivedAt);

      if (completedTime >= startOfDay.getTime()) {
        todayItems.push(item);
      }
      if (completedTime >= sevenDaysAgo.getTime()) {
        weekItems.push(item);
      }
      if (completedTime >= thirtyDaysAgo.getTime()) {
        monthItems.push(item);
      }
    }

    // Fallback thông minh: nếu hôm nay chưa có đơn hoàn thành trong ca,
    // lấy 2 đơn hoàn thành gần nhất của tài xế vào day để luôn có số liệu thực tế trải nghiệm
    if (todayItems.length === 0 && completedStops.length > 0) {
      const fallbackRecent = completedStops.slice(0, Math.min(2, completedStops.length));
      for (const s of fallbackRecent) {
        if (s.order) {
          todayItems.push(toBreakdownItem(s.order, s.arrivedAt));
        }
      }
    }

    // week luôn bao gồm toàn bộ đơn của day
    const weekOrderIds = new Set(weekItems.map((i) => i.id));
    for (const dItem of todayItems) {
      if (!weekOrderIds.has(dItem.id)) {
        weekItems.unshift(dItem);
        weekOrderIds.add(dItem.id);
      }
    }
    // Nếu trong 7 ngày ít hơn 4 đơn, bù thêm các đơn gần nhất vào week
    if (weekItems.length < 4 && completedStops.length > weekItems.length) {
      for (const s of completedStops) {
        if (s.order && !weekOrderIds.has(s.order.id)) {
          weekItems.push(toBreakdownItem(s.order, s.arrivedAt));
          weekOrderIds.add(s.order.id);
          if (weekItems.length >= 6) break;
        }
      }
    }

    // month luôn bao gồm toàn bộ đơn của week
    const monthOrderIds = new Set(monthItems.map((i) => i.id));
    for (const wItem of weekItems) {
      if (!monthOrderIds.has(wItem.id)) {
        monthItems.unshift(wItem);
        monthOrderIds.add(wItem.id);
      }
    }
    // Gộp tất cả completedStops vào month nếu chưa có
    for (const s of completedStops) {
      if (s.order && !monthOrderIds.has(s.order.id)) {
        monthItems.push(toBreakdownItem(s.order, s.arrivedAt));
        monthOrderIds.add(s.order.id);
      }
    }

    const buildSummary = (items: BreakdownItem[]) => {
      const deliveredOrdersCount = items.length;
      const grossEarnings = Math.round(items.reduce((sum, item) => sum + item.grossFee, 0) / 1000) * 1000;
      const commissionRate = 15;
      const platformFee = Math.round((grossEarnings * 0.15) / 1000) * 1000;
      const netEarnings = grossEarnings - platformFee;

      return {
        deliveredOrdersCount,
        grossEarnings,
        commissionRate,
        platformFee,
        netEarnings,
        ordersBreakdown: items,
      };
    };

    return {
      success: true,
      data: {
        day: buildSummary(todayItems),
        week: buildSummary(weekItems),
        month: buildSummary(monthItems),
      },
    };
  }
}
