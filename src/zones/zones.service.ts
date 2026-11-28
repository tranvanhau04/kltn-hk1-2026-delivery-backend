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

  private buildOverloadMetricsFromAggregates(
    totalOrders: number,
    demandWeight: number,
    demandVolume: number,
    assignedDrivers: Pick<Driver, 'currentShiftStatus' | 'maxWeightKg' | 'maxVolumeM3'>[],
  ): ZoneOverloadMetrics {
    const activeDrivers = assignedDrivers.filter((d) =>
      ACTIVE_SHIFT_STATUSES.includes(d.currentShiftStatus),
    );

    const activeDriversCount = activeDrivers.length;
    const fleetCapacityWeight = activeDrivers.reduce((sum, d) => sum + Number(d.maxWeightKg), 0);
    const fleetCapacityVolume = activeDrivers.reduce((sum, d) => sum + Number(d.maxVolumeM3), 0);

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

  private parseStoredGeoJson(raw: unknown): object | null {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    if (typeof raw === 'string' && raw.trim() !== '') {
      try {
        return JSON.parse(raw) as object;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Real-world fleet overload algorithm:
   * 1. Aggregate pending orders (NEW | ASSIGNED) in the zone via SQL SUM/COUNT.
   * 2. Aggregate capacity of assigned active drivers.
   * 3. Compute utilization ratios and severity.
   */
  async computeOverload(zoneId: string): Promise<ZoneOverloadMetrics> {
    const [orderAgg, zonDriverRows] = await Promise.all([
      this.orderRepo
        .createQueryBuilder('o')
        .select('COUNT(o.id)', 'totalOrders')
        .addSelect('COALESCE(SUM(o.weight_kg), 0)', 'demandWeight')
        .addSelect('COALESCE(SUM(o.volume_m3), 0)', 'demandVolume')
        .where('o.zone_id = :zoneId', { zoneId })
        .andWhere('o.status IN (:...statuses)', { statuses: ['NEW', 'ASSIGNED'] })
        .getRawOne<{
          totalOrders?: string | number;
          demandWeight?: string | number;
          demandVolume?: string | number;
        }>(),
      this.zoneDriverRepo.find({ where: { zoneId } }),
    ]);

    const totalOrders = Number(orderAgg?.totalOrders) || 0;
    const demandWeight = Number(orderAgg?.demandWeight) || 0;
    const demandVolume = Number(orderAgg?.demandVolume) || 0;

    const assignedDriverIds = zonDriverRows.map((zd) => zd.driverId);
    const assignedDrivers =
      assignedDriverIds.length > 0
        ? await this.driverRepo.find({
            where: { userId: In(assignedDriverIds) },
            select: ['userId', 'currentShiftStatus', 'maxWeightKg', 'maxVolumeM3'],
          })
        : [];

    return this.buildOverloadMetricsFromAggregates(
      totalOrders,
      demandWeight,
      demandVolume,
      assignedDrivers,
    );
  }

  // ─── Zone CRUD ──────────────────────────────────────────────────────────────

  async findAll(): Promise<ZoneWithMetrics[]> {
    const zones = await this.zoneRepo.find({ order: { createdAt: 'ASC' } });
    if (zones.length === 0) return [];

    const zoneIds = zones.map((z) => z.id);

    // Batch-fetch order demand aggregates & driver assignments across ALL zones (eliminates 4Z N+1 queries)
    const [orderAggRows, allZoneDrivers] = await Promise.all([
      this.orderRepo
        .createQueryBuilder('o')
        .select('o.zone_id', 'zoneId')
        .addSelect('COUNT(o.id)', 'totalOrders')
        .addSelect('COALESCE(SUM(o.weight_kg), 0)', 'demandWeight')
        .addSelect('COALESCE(SUM(o.volume_m3), 0)', 'demandVolume')
        .where('o.zone_id IN (:...zoneIds)', { zoneIds })
        .andWhere('o.status IN (:...statuses)', { statuses: ['NEW', 'ASSIGNED'] })
        .groupBy('o.zone_id')
        .getRawMany<{
          zoneId: string;
          totalOrders: string | number;
          demandWeight: string | number;
          demandVolume: string | number;
        }>(),
      this.zoneDriverRepo.find({ where: { zoneId: In(zoneIds) } }),
    ]);

    const uniqueDriverIds = [...new Set(allZoneDrivers.map((zd) => zd.driverId))];
    const allDrivers =
      uniqueDriverIds.length > 0
        ? await this.driverRepo.find({
            where: { userId: In(uniqueDriverIds) },
            select: ['userId', 'currentShiftStatus', 'maxWeightKg', 'maxVolumeM3'],
          })
        : [];

    const driverMap = new Map(allDrivers.map((d) => [d.userId, d]));
    const orderAggMap = new Map(
      orderAggRows.map((row) => [
        row.zoneId,
        {
          totalOrders: Number(row.totalOrders) || 0,
          demandWeight: Number(row.demandWeight) || 0,
          demandVolume: Number(row.demandVolume) || 0,
        },
      ]),
    );

    const driversByZone = new Map<string, string[]>();
    for (const zd of allZoneDrivers) {
      const list = driversByZone.get(zd.zoneId) ?? [];
      list.push(zd.driverId);
      driversByZone.set(zd.zoneId, list);
    }

    return zones.map((zone) => {
      const agg = orderAggMap.get(zone.id) ?? {
        totalOrders: 0,
        demandWeight: 0,
        demandVolume: 0,
      };
      const assignedDriverIds = driversByZone.get(zone.id) ?? [];
      const assignedDrivers = assignedDriverIds
        .map((id) => driverMap.get(id))
        .filter((d): d is Driver => Boolean(d));

      return {
        id: zone.id,
        name: zone.name,
        boundaryGeoJson: this.parseStoredGeoJson(zone.boundaryGeoJson),
        createdAt: zone.createdAt,
        assignedDriverIds,
        metrics: this.buildOverloadMetricsFromAggregates(
          agg.totalOrders,
          agg.demandWeight,
          agg.demandVolume,
          assignedDrivers,
        ),
      };
    });
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

  /**
   * DELETE /zones/:id
   * Safely unlinks orders and assigned drivers, then deletes the zone.
   */
  async remove(zoneId: string): Promise<{ success: boolean; deletedId: string }> {
    const zone = await this.zoneRepo.findOne({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException(`Không tìm thấy khu vực với ID: ${zoneId}`);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Order, { zoneId }, { zoneId: null });
      await manager.delete(ZoneDriver, { zoneId });
      await manager.delete(Zone, { id: zoneId });
    });

    this.logger.log(`Deleted zone ${zoneId} (${zone.name})`);
    return { success: true, deletedId: zoneId };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private async toZoneWithMetrics(zone: Zone): Promise<ZoneWithMetrics> {
    const zoneDriverRows = await this.zoneDriverRepo.find({ where: { zoneId: zone.id } });
    const assignedDriverIds = zoneDriverRows.map((zd) => zd.driverId);

    const [orderAgg, assignedDrivers] = await Promise.all([
      this.orderRepo
        .createQueryBuilder('o')
        .select('COUNT(o.id)', 'totalOrders')
        .addSelect('COALESCE(SUM(o.weight_kg), 0)', 'demandWeight')
        .addSelect('COALESCE(SUM(o.volume_m3), 0)', 'demandVolume')
        .where('o.zone_id = :zoneId', { zoneId: zone.id })
        .andWhere('o.status IN (:...statuses)', { statuses: ['NEW', 'ASSIGNED'] })
        .getRawOne<{
          totalOrders?: string | number;
          demandWeight?: string | number;
          demandVolume?: string | number;
        }>(),
      assignedDriverIds.length > 0
        ? this.driverRepo.find({
            where: { userId: In(assignedDriverIds) },
            select: ['userId', 'currentShiftStatus', 'maxWeightKg', 'maxVolumeM3'],
          })
        : Promise.resolve([]),
    ]);

    return {
      id: zone.id,
      name: zone.name,
      boundaryGeoJson: this.parseStoredGeoJson(zone.boundaryGeoJson),
      createdAt: zone.createdAt,
      assignedDriverIds,
      metrics: this.buildOverloadMetricsFromAggregates(
        Number(orderAgg?.totalOrders) || 0,
        Number(orderAgg?.demandWeight) || 0,
        Number(orderAgg?.demandVolume) || 0,
        assignedDrivers,
      ),
    };
  }
}
