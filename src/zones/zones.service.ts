import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Zone } from '../entities/zone.entity';
import { ZoneDriver } from '../entities/zone-driver.entity';
import { Driver } from '../entities/driver.entity';
import { Order } from '../entities/order.entity';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { AssignDriversDto } from './dto/assign-drivers.dto';

// ─── Overload Severity Thresholds ────────────────────────────────────────────

const WARNING_RATIO = 0.8;
const CRITICAL_RATIO = 1.0;

export type OverloadSeverity = 'NORMAL' | 'WARNING' | 'CRITICAL';

/** Active driver shift statuses considered "available for capacity calculation" */
const ACTIVE_SHIFT_STATUSES = ['ONLINE_READY', 'ON_DUTY'];

// ─── Response Shapes ─────────────────────────────────────────────────────────

export interface ZoneOverloadMetrics {
  totalOrders: number;
  demandWeight: number;
  demandVolume: number;
  activeDriversCount: number;
  fleetCapacityWeight: number;
  fleetCapacityVolume: number;
  weightRatio: number;
  volumeRatio: number;
  isOverloaded: boolean;
  overloadSeverity: OverloadSeverity;
}

export interface ZoneWithMetrics {
  id: string;
  name: string;
  boundaryGeoJson: object | null;
  createdAt: Date;
  assignedDriverIds: string[];
  metrics: ZoneOverloadMetrics;
}

// ─── GeoJSON validation helper ────────────────────────────────────────────────

export function normalizeAndValidateGeoJson(raw: string | Record<string, unknown>): {
  parsed: object;
  stringified: string;
} {
  let parsed: unknown;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new BadRequestException('boundaryGeoJson không được để trống.');
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new BadRequestException('boundaryGeoJson không phải là chuỗi JSON hợp lệ.');
    }
  } else if (typeof raw === 'object' && raw !== null) {
    parsed = raw;
  } else {
    throw new BadRequestException('boundaryGeoJson phải là chuỗi JSON hoặc đối tượng GeoJSON.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new BadRequestException('boundaryGeoJson phải là đối tượng GeoJSON hợp lệ.');
  }

  const geo = parsed as { type?: string; coordinates?: unknown };
  if (!['Polygon', 'MultiPolygon'].includes(geo.type ?? '')) {
    throw new BadRequestException('boundaryGeoJson phải là GeoJSON Polygon hoặc MultiPolygon.');
  }

  if (!geo.coordinates || !Array.isArray(geo.coordinates)) {
    throw new BadRequestException('Tọa độ coordinates của GeoJSON không hợp lệ.');
  }

  return {
    parsed: parsed,
    stringified: typeof raw === 'string' ? raw : JSON.stringify(raw),
  };
}

@Injectable()
export class ZonesService {
  private readonly logger = new Logger(ZonesService.name);

  constructor(
    @InjectRepository(Zone)
    private readonly zoneRepo: Repository<Zone>,

    @InjectRepository(ZoneDriver)
    private readonly zoneDriverRepo: Repository<ZoneDriver>,

    @InjectRepository(Driver)
    private readonly driverRepo: Repository<Driver>,

    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ─── Compute Overload ───────────────────────────────────────────────────────

  /**
   * Real-world fleet overload algorithm:
   * 1. Aggregate pending orders (NEW | ASSIGNED) in the zone.
   * 2. Aggregate capacity of assigned active drivers.
   * 3. Compute utilization ratios and severity.
   */
  async computeOverload(zoneId: string): Promise<ZoneOverloadMetrics> {
    // 1. Pending demand in zone
    const pendingOrders = await this.orderRepo.find({
      where: { zoneId, status: In(['NEW', 'ASSIGNED']) },
    });

    const totalOrders = pendingOrders.length;
    const demandWeight = pendingOrders.reduce((sum, o) => sum + Number(o.weightKg), 0);
    const demandVolume = pendingOrders.reduce((sum, o) => sum + Number(o.volumeM3), 0);

    // 2. Assigned active drivers
    const zonDriverRows = await this.zoneDriverRepo.find({ where: { zoneId } });
    const assignedDriverIds = zonDriverRows.map((zd) => zd.driverId);

    let fleetCapacityWeight = 0;
    let fleetCapacityVolume = 0;
    let activeDriversCount = 0;

    if (assignedDriverIds.length > 0) {
      const assignedDrivers = await this.driverRepo.find({
        where: { userId: In(assignedDriverIds) },
      });

      const activeDrivers = assignedDrivers.filter((d) =>
        ACTIVE_SHIFT_STATUSES.includes(d.currentShiftStatus),
      );

      activeDriversCount = activeDrivers.length;
      fleetCapacityWeight = activeDrivers.reduce((sum, d) => sum + Number(d.maxWeightKg), 0);
      fleetCapacityVolume = activeDrivers.reduce((sum, d) => sum + Number(d.maxVolumeM3), 0);
    }

    // 3. Ratios (prevent division by zero with logistics-safe defaults)
    const weightRatio =
      fleetCapacityWeight > 0 ? demandWeight / fleetCapacityWeight : demandWeight > 0 ? 999 : 0;

    const volumeRatio =
      fleetCapacityVolume > 0 ? demandVolume / fleetCapacityVolume : demandVolume > 0 ? 999 : 0;

    const isOverloaded =
      weightRatio > CRITICAL_RATIO ||
      volumeRatio > CRITICAL_RATIO ||
      (totalOrders > 0 && activeDriversCount === 0);

    let overloadSeverity: OverloadSeverity = 'NORMAL';
    if (weightRatio > CRITICAL_RATIO || volumeRatio > CRITICAL_RATIO) {
      overloadSeverity = 'CRITICAL';
    } else if (weightRatio > WARNING_RATIO || volumeRatio > WARNING_RATIO) {
      overloadSeverity = 'WARNING';
    } else if (totalOrders > 0 && activeDriversCount === 0) {
      // Has orders but zero active drivers → treat as critical
      overloadSeverity = 'CRITICAL';
    }

    return {
      totalOrders,
      demandWeight: Math.round(demandWeight * 100) / 100,
      demandVolume: Math.round(demandVolume * 1000) / 1000,
      activeDriversCount,
      fleetCapacityWeight: Math.round(fleetCapacityWeight * 100) / 100,
      fleetCapacityVolume: Math.round(fleetCapacityVolume * 1000) / 1000,
      weightRatio: Math.round(weightRatio * 1000) / 1000,
      volumeRatio: Math.round(volumeRatio * 1000) / 1000,
      isOverloaded,
      overloadSeverity,
    };
  }

  // ─── Zone CRUD ──────────────────────────────────────────────────────────────

  async findAll(): Promise<ZoneWithMetrics[]> {
    const zones = await this.zoneRepo.find({ order: { createdAt: 'ASC' } });
    return Promise.all(zones.map((z) => this.toZoneWithMetrics(z)));
  }

  async findOne(id: string): Promise<ZoneWithMetrics> {
    const zone = await this.zoneRepo.findOne({ where: { id } });
    if (!zone) {
      throw new NotFoundException(`Không tìm thấy khu vực với ID: ${id}`);
    }
    return this.toZoneWithMetrics(zone);
  }

  async create(dto: CreateZoneDto): Promise<ZoneWithMetrics> {
    let stringifiedGeoJson: string | null = null;
    if (dto.boundaryGeoJson) {
      const validated = normalizeAndValidateGeoJson(dto.boundaryGeoJson);
      stringifiedGeoJson = validated.stringified;
    }

    const zone = this.zoneRepo.create({
      id: uuidv4(),
      name: dto.name,
      boundaryGeoJson: stringifiedGeoJson,
    });

    const saved = await this.zoneRepo.save(zone);
    return this.toZoneWithMetrics(saved);
  }

  async update(id: string, dto: UpdateZoneDto): Promise<ZoneWithMetrics> {
    const zone = await this.zoneRepo.findOne({ where: { id } });
    if (!zone) throw new NotFoundException(`Không tìm thấy khu vực với ID: ${id}`);

    if (dto.name !== undefined) {
      zone.name = dto.name;
    }

    if (dto.boundaryGeoJson !== undefined) {
      if (dto.boundaryGeoJson === null || dto.boundaryGeoJson === '') {
        zone.boundaryGeoJson = null;
      } else {
        const validated = normalizeAndValidateGeoJson(dto.boundaryGeoJson);
        zone.boundaryGeoJson = validated.stringified;
      }
    }

    const saved = await this.zoneRepo.save(zone);
    return this.toZoneWithMetrics(saved);
  }

  async updateBoundary(
    id: string,
    boundaryGeoJson: string | Record<string, unknown>,
  ): Promise<ZoneWithMetrics> {
    return this.update(id, { boundaryGeoJson });
  }

  // ─── Driver Assignment ──────────────────────────────────────────────────────

  /**
   * Idempotent: assigns drivers to zone. Skips duplicates.
   * Uses a transaction for rollback on any failure.
   */
  async assignDrivers(zoneId: string, dto: AssignDriversDto): Promise<ZoneWithMetrics> {
    const zone = await this.zoneRepo.findOne({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException(`Không tìm thấy khu vực với ID: ${zoneId}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (const driverId of dto.driverIds) {
        // Verify driver exists
        const driver = await queryRunner.manager.findOne(Driver, {
          where: { userId: driverId },
        });
        if (!driver) {
          throw new NotFoundException(`Không tìm thấy tài xế với ID: ${driverId}`);
        }

        // Check if already assigned to another zone (1 driver belongs to at most 1 zone)
        const existingAssignment = await queryRunner.manager.findOne(ZoneDriver, {
          where: { driverId },
        });
        if (existingAssignment && existingAssignment.zoneId !== zoneId) {
          const otherZone = await queryRunner.manager.findOne(Zone, {
            where: { id: existingAssignment.zoneId },
          });
          const otherZoneName = otherZone ? otherZone.name : existingAssignment.zoneId;
          throw new ConflictException(
            `Tài xế này đã được phân công ở khu vực ${otherZoneName}. Vui lòng gỡ khỏi khu vực cũ trước khi chuyển.`,
          );
        }

        // Check if already assigned to this zone (idempotent)
        if (!existingAssignment) {
          const zd = queryRunner.manager.create(ZoneDriver, { zoneId, driverId });
          await queryRunner.manager.save(zd);
          this.logger.log(`Assigned driver ${driverId} to zone ${zoneId}`);
        }
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    return this.findOne(zoneId);
  }

  /**
   * Removes a driver from a zone.
   * Returns 404 if the assignment does not exist.
   */
  async unassignDriver(zoneId: string, driverId: string): Promise<ZoneWithMetrics> {
    const zone = await this.zoneRepo.findOne({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException(`Không tìm thấy khu vực với ID: ${zoneId}`);

    const assignment = await this.zoneDriverRepo.findOne({ where: { zoneId, driverId } });
    if (!assignment) {
      throw new ConflictException(`Tài xế ${driverId} chưa được gán vào khu vực ${zoneId}.`);
    }

    await this.zoneDriverRepo.remove(assignment);
    this.logger.log(`Unassigned driver ${driverId} from zone ${zoneId}`);

    return this.findOne(zoneId);
  }

  /**
   * GET /zones/:id/drivers
   * Returns the full Driver objects for all drivers assigned to the zone.
   */
  async getAssignedDrivers(zoneId: string): Promise<Driver[]> {
    const zone = await this.zoneRepo.findOne({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException(`Không tìm thấy khu vực với ID: ${zoneId}`);

    const assignments = await this.zoneDriverRepo.find({ where: { zoneId } });
    if (assignments.length === 0) return [];

    const driverIds = assignments.map((a) => a.driverId);
    return this.driverRepo.find({ where: { userId: In(driverIds) } });
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private async toZoneWithMetrics(zone: Zone): Promise<ZoneWithMetrics> {
    const [metrics, zoneDriverRows] = await Promise.all([
      this.computeOverload(zone.id),
      this.zoneDriverRepo.find({ where: { zoneId: zone.id } }),
    ]);

    let parsedGeoJson: object | null = null;
    if (zone.boundaryGeoJson) {
      if (typeof zone.boundaryGeoJson === 'object') {
        parsedGeoJson = zone.boundaryGeoJson;
      } else if (typeof zone.boundaryGeoJson === 'string' && zone.boundaryGeoJson.trim() !== '') {
        try {
          parsedGeoJson = JSON.parse(zone.boundaryGeoJson) as object;
        } catch {
          parsedGeoJson = null;
        }
      }
    }

    return {
      id: zone.id,
      name: zone.name,
      boundaryGeoJson: parsedGeoJson,
      createdAt: zone.createdAt,
      assignedDriverIds: zoneDriverRows.map((zd) => zd.driverId),
      metrics,
    };
  }
}
