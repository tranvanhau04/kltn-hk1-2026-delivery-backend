import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Shift, ShiftStatus } from '../entities/shift.entity';
import { Driver, DriverShiftStatus } from '../entities/driver.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { OrderStatus } from '../entities/order.entity';
import { Depot } from '../entities/depot.entity';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

/**
 * ShiftsService — driver shift lifecycle management and active route retrieval.
 *
 * Key invariant: the `drivers` table uses `user_id` (= user.id) as its PK.
 * Therefore "driverId" in this service == JwtPayload.sub (the user's UUID).
 */
@Injectable()
export class ShiftsService {
  private readonly logger = new Logger(ShiftsService.name);

  constructor(
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,

    @InjectRepository(Driver)
    private readonly driverRepo: Repository<Driver>,

    @InjectRepository(Route)
    private readonly routeRepo: Repository<Route>,

    @InjectRepository(Stop)
    private readonly stopRepo: Repository<Stop>,

    @InjectRepository(Depot)
    private readonly depotRepo: Repository<Depot>,
  ) {}

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Look up the driver record for the currently authenticated user.
   * Throws NotFoundException if no driver profile exists.
   */
  private async resolveDriver(user: JwtPayload): Promise<Driver> {
    // drivers.user_id = users.id → userId === user.sub
    const driver = await this.driverRepo.findOne({ where: { userId: user.sub } });
    if (!driver) {
      throw new NotFoundException(
        `Không tìm thấy hồ sơ tài xế cho tài khoản hiện tại (userId=${user.sub})`,
      );
    }
    return driver;
  }

  private formatShift(shift: Shift) {
    return {
      id: shift.id,
      driverId: shift.driverId,
      startTime: shift.startTime,
      endTime: shift.endTime ?? null,
      status: shift.status,
      startingCashCod: Number(shift.startingCashCod),
      codCollected: Number(shift.codCollected) || 0,
      codSubmitted: Number(shift.codSubmitted) || 0,
      currentLatitude: shift.currentLatitude !== null ? Number(shift.currentLatitude) : null,
      currentLongitude: shift.currentLongitude !== null ? Number(shift.currentLongitude) : null,
      createdAt: shift.createdAt,
      updatedAt: shift.updatedAt,
    };
  }

  // ─── POST /shifts/open ───────────────────────────────────────────────────────

  /**
   * Open a new shift for the authenticated driver.
   * Idempotent: if an OPEN shift already exists, returns it with HTTP 200.
   */
  async openShift(dto: OpenShiftDto, user: JwtPayload) {
    const driver = await this.resolveDriver(user);

    // Check for an already-open shift (idempotency)
    const existingShift = await this.shiftRepo.findOne({
      where: { driverId: driver.userId, status: ShiftStatus.OPEN },
    });

    if (existingShift) {
      this.logger.log(`Driver ${driver.userId} already has an open shift: ${existingShift.id}`);
      return {
        success: true,
        message: 'Ca làm việc hiện đang mở (đã tồn tại)',
        shift: this.formatShift(existingShift),
      };
    }

    // Create new shift
    const shift = this.shiftRepo.create({
      driverId: driver.userId,
      startTime: new Date(),
      status: ShiftStatus.OPEN,
      startingCashCod: dto.startingCash ?? 0,
      currentLatitude: dto.latitude ?? null,
      currentLongitude: dto.longitude ?? null,
    });

    const saved = await this.shiftRepo.save(shift);

    // Update driver status → ONLINE_READY
    await this.driverRepo.update(
      { userId: driver.userId },
      { currentShiftStatus: DriverShiftStatus.ONLINE_READY },
    );

    this.logger.log(`Driver ${driver.userId} opened shift ${saved.id}`);

    return {
      success: true,
      message: 'Ca làm việc đã mở thành công',
      shift: this.formatShift(saved),
    };
  }

  // ─── POST /shifts/:id/close & POST /shifts/close ─────────────────────────────

  /**
   * Task 9.1: Close shift by ID with COD declaration.
   * Business rules:
   *   1. Shift must exist
   *   2. Shift must belong to the authenticated driver
   *   3. Shift must be in OPEN status
   *   4. Check pending/arrived stops on active route (warn, don't block)
   *   5. Update status → PENDING_SETTLEMENT, end_time = now, cod_submitted = dto.codSubmitted
   *   6. Update driver.current_shift_status → OFFLINE
   *   7. Calculate codDifference = codCollected - codSubmitted
   */
  async closeShiftById(shiftId: string, dto: CloseShiftDto, user: JwtPayload) {
    const driver = await this.resolveDriver(user);

    // 1. Tìm ca làm việc theo ID
    const shift = await this.shiftRepo.findOne({ where: { id: shiftId } });

    if (!shift) {
      throw new NotFoundException(`Không tìm thấy ca làm việc với id=${shiftId}`);
    }

    // 2. Xác thực quyền sở hữu
    if (shift.driverId !== driver.userId) {
      throw new ForbiddenException('Bạn không có quyền đóng ca làm việc này');
    }

    // 3. Kiểm tra trạng thái OPEN
    if (shift.status !== ShiftStatus.OPEN) {
      throw new BadRequestException(
        `Ca làm việc đang ở trạng thái ${shift.status}, chỉ có thể đóng ca đang OPEN`,
      );
    }

    // 4. Kiểm tra stops còn pending (cảnh báo nhưng vẫn cho đóng ca)
    let pendingStopsCount = 0;
    const activeRoute = await this.routeRepo
      .createQueryBuilder('route')
      .where('route.driver_id = :driverId', { driverId: driver.userId })
      .andWhere('route.status IN (:...statuses)', {
        statuses: ['ASSIGNED', 'IN_PROGRESS', 'CONFIRMED', 'PLANNED'],
      })
      .orderBy('route.created_at', 'DESC')
      .getOne();

    if (activeRoute) {
      pendingStopsCount = await this.stopRepo.count({
        where: { routeId: activeRoute.id, status: In(['PENDING', 'ARRIVED']) },
      });
    }

    // 5. Cập nhật shift
    shift.status = ShiftStatus.PENDING_SETTLEMENT;
    shift.endTime = new Date();
    shift.codSubmitted = dto.codSubmitted;
    if (dto.latitude !== undefined) shift.currentLatitude = dto.latitude;
    if (dto.longitude !== undefined) shift.currentLongitude = dto.longitude;

    const saved = await this.shiftRepo.save(shift);

    // 6. Chuyển trạng thái tài xế sang OFFLINE
    await this.driverRepo.update(
      { userId: driver.userId },
      { currentShiftStatus: DriverShiftStatus.OFFLINE },
    );

    // 7. Tính chênh lệch COD
    const codCollected = Number(shift.codCollected) || 0;
    const codSubmitted = Number(dto.codSubmitted) || 0;
    const codDifference = codCollected - codSubmitted;

    this.logger.log(
      `Driver ${driver.userId} closed shift ${saved.id} → PENDING_SETTLEMENT ` +
        `(collected=${codCollected}, submitted=${codSubmitted}, diff=${codDifference})`,
    );

    return {
      success: true,
      message: 'Đã đóng ca thành công. Chờ thủ quỹ đối soát.',
      shift: this.formatShift(saved),
      summary: {
        codCollected,
        codSubmitted,
        codDifference,
        pendingStopsWarning:
          pendingStopsCount > 0 ? `Còn ${pendingStopsCount} điểm dừng chưa hoàn thành` : null,
      },
    };
  }

  /**
   * Close the currently-open shift for the authenticated driver.
   * Backward-compatible wrapper delegating to closeShiftById.
   */
  async closeShift(dto: CloseShiftDto, user: JwtPayload) {
    const driver = await this.resolveDriver(user);

    const shift = await this.shiftRepo.findOne({
      where: { driverId: driver.userId, status: ShiftStatus.OPEN },
    });

    if (!shift) {
      throw new BadRequestException('Tài xế hiện không có ca làm việc nào đang mở');
    }

    const closeDto: CloseShiftDto = {
      codSubmitted: dto.codSubmitted ?? dto.endingCash ?? 0,
      notes: dto.notes,
      latitude: dto.latitude,
      longitude: dto.longitude,
    };

    return this.closeShiftById(shift.id, closeDto, user);
  }

  // ─── GET /driver/active-route ─────────────────────────────────────────────────

  /**
   * Returns the most recent active route for the authenticated driver.
   * "Active" = status IN ('ASSIGNED', 'IN_PROGRESS', 'CONFIRMED', 'PLANNED').
   * Stops are sorted by sequence_no ASC.
   */
  async getActiveRoute(user: JwtPayload) {
    const driver = await this.resolveDriver(user);

    const activeStatuses = ['ASSIGNED', 'IN_PROGRESS', 'CONFIRMED', 'PLANNED'];

    // Query latest route for this driver in active states
    const route = await this.routeRepo
      .createQueryBuilder('route')
      .where('route.driver_id = :driverId', { driverId: driver.userId })
      .andWhere('route.status IN (:...statuses)', { statuses: activeStatuses })
      .orderBy('route.created_at', 'DESC')
      .getOne();

    if (!route) {
      return {
        hasActiveRoute: false,
        message: 'Không có lộ trình giao hàng hoạt động hôm nay',
        route: null,
      };
    }

    // Load stops sorted by sequence_no ASC, with eager Order relation
    const stops = await this.stopRepo.find({
      where: { routeId: route.id },
      order: { sequenceNo: 'ASC' },
      relations: ['order'],
    });

    // Load depot
    const depot = await this.depotRepo.findOne({ where: { id: route.depotId } });

    // Parse polyline
    let polyline: [number, number][] = [];
    if (route.polyline) {
      try {
        polyline = JSON.parse(route.polyline) as [number, number][];
      } catch {
        polyline = [];
      }
    }

    return {
      hasActiveRoute: true,
      route: {
        id: route.id,
        status: route.status,
        totalDistanceKm: Number(route.totalDistanceKm),
        totalDurationMinutes: Number(route.totalEstimatedTimeMin),
        polyline,
        depot: depot
          ? {
              id: depot.id,
              name: depot.name,
              address: depot.address,
              latitude: Number(depot.latitude),
              longitude: Number(depot.longitude),
            }
          : null,
        stops: stops.map((s) => ({
          id: s.id,
          sequenceNo: s.sequenceNo,
          status: s.status,
          arrivedAt: s.arrivedAt ?? null,
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
      },
    };
  }

  // ─── GET /driver/shift/summary ────────────────────────────────────────────────

  /**
   * Returns a summary dashboard for the authenticated driver.
   * Used by mobile Frame 16: shift status card, order counters, COD balance.
   */
  async getShiftSummary(user: JwtPayload) {
    const driver = await this.resolveDriver(user);

    // Current open shift (if any)
    const activeShift = await this.shiftRepo.findOne({
      where: { driverId: driver.userId, status: ShiftStatus.OPEN },
    });

    // Refresh driver to get current status
    const freshDriver = await this.driverRepo.findOne({ where: { userId: driver.userId } });

    let assignedOrdersCount = 0;
    let deliveredOrdersCount = 0;
    let failedOrdersCount = 0;
    let pendingCodAmount = 0;

    // Find the latest active route
    const activeStatuses = ['ASSIGNED', 'IN_PROGRESS', 'CONFIRMED', 'PLANNED'];
    const route = await this.routeRepo
      .createQueryBuilder('route')
      .where('route.driver_id = :driverId', { driverId: driver.userId })
      .andWhere('route.status IN (:...statuses)', { statuses: activeStatuses })
      .orderBy('route.created_at', 'DESC')
      .getOne();

    if (route) {
      const stops = await this.stopRepo.find({
        where: { routeId: route.id },
        relations: ['order'],
      });

      assignedOrdersCount = stops.length;

      const deliveredStops = stops.filter((s) => s.order?.status === OrderStatus.DELIVERED);
      deliveredOrdersCount = deliveredStops.length;

      failedOrdersCount = stops.filter(
        (s) =>
          s.order?.status === OrderStatus.FAILED ||
          s.order?.status === OrderStatus.RESCHEDULED ||
          s.order?.status === OrderStatus.CANCELLED,
      ).length;

      pendingCodAmount = deliveredStops.reduce(
        (sum, s) => sum + (s.order ? Number(s.order.codAmount) : 0),
        0,
      );
    }

    return {
      shiftStatus: freshDriver?.currentShiftStatus ?? DriverShiftStatus.OFFLINE,
      activeShift: activeShift ? this.formatShift(activeShift) : null,
      assignedOrdersCount,
      deliveredOrdersCount,
      failedOrdersCount,
      pendingCodAmount,
    };
  }
}
