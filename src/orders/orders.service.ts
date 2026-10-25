import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Brackets } from 'typeorm';
import * as xlsx from 'xlsx';
import * as crypto from 'crypto';
import { Order, OrderStatus } from '../entities/order.entity';
import { Depot } from '../entities/depot.entity';
import { OrderStatusHistory } from '../entities/order-status-history.entity';
import { Stop } from '../entities/stop.entity';
import { ProofOfDelivery } from '../entities/proof-of-delivery.entity';
import { GeocodingService } from '../geocoding/geocoding.service';
import { UpdateCoordinatesDto } from './dto/update-coordinates.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';

/** Default Hub coordinates (IUH campus, Gò Vấp) used as geocoding fallback */
const DEFAULT_DEPOT_LAT = 10.8468;
const DEFAULT_DEPOT_LNG = 106.6752;

interface RawOrderWithDriver {
  driverName?: string | null;
  driver_user_full_name?: string | null;
  driverId?: string | null;
  route_driver_id?: string | null;
}

export type OrderWithDriver = Order & {
  driverName: string | null;
  driverId: string | null;
};

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Depot)
    private readonly depotRepo: Repository<Depot>,
    @InjectRepository(OrderStatusHistory)
    private readonly historyRepo: Repository<OrderStatusHistory>,
    @InjectRepository(Stop)
    private readonly stopRepo: Repository<Stop>,
    @InjectRepository(ProofOfDelivery)
    private readonly podRepo: Repository<ProofOfDelivery>,
    private readonly geocodingService: GeocodingService,
    private readonly dataSource: DataSource,
  ) {}

  /** Returns all orders based on query filters */
  async findAll(query: QueryOrderDto): Promise<{ data: OrderWithDriver[]; total: number }> {
    const { status, zoneId, search, page = 1, limit = 50 } = query;
    const qb = this.orderRepo
      .createQueryBuilder('order')
      .leftJoin('stops', 'stop', 'stop.order_id = order.id')
      .leftJoin('routes', 'route', 'route.id = stop.route_id')
      .leftJoin('users', 'driver_user', 'driver_user.id = route.driver_id')
      .addSelect('driver_user.full_name', 'driverName')
      .addSelect('route.driver_id', 'driverId');

    if (status) {
      if (Array.isArray(status)) {
        qb.andWhere('order.status IN (:...status)', { status });
      } else {
        qb.andWhere('order.status = :status', { status });
      }
    }

    if (zoneId) {
      qb.andWhere('order.zone_id = :zoneId', { zoneId });
    }

    if (search) {
      qb.andWhere(
        new Brackets((sqb) => {
          sqb
            .where('order.code LIKE :search', { search: `%${search}%` })
            .orWhere('order.receiver_name LIKE :search', { search: `%${search}%` })
            .orWhere('order.receiver_phone LIKE :search', { search: `%${search}%` });
        }),
      );
    }

    qb.orderBy('order.createdAt', 'DESC');
    qb.skip((page - 1) * limit);
    qb.take(limit);

    const [rawAndEntities, total] = await Promise.all([qb.getRawAndEntities(), qb.getCount()]);

    const { entities, raw } = rawAndEntities;
    const rawTyped = raw as RawOrderWithDriver[];
    const data: OrderWithDriver[] = entities.map((entity, index) => {
      const rawItem = rawTyped[index];
      const driverName: string | null =
        rawItem?.driverName ?? rawItem?.driver_user_full_name ?? null;
      const driverId: string | null = rawItem?.driverId ?? rawItem?.route_driver_id ?? null;
      return Object.assign(new Order(), entity, {
        driverName,
        driverId,
      });
    });
    return { data, total };
  }

  /** Returns orders with status NEW */
  findPool(): Promise<Order[]> {
    return this.orderRepo.find({
      where: { status: OrderStatus.NEW },
      order: { createdAt: 'DESC' },
    });
  }

  /** Returns a single order by ID */
  async findById(id: string): Promise<OrderWithDriver> {
    const qb = this.orderRepo
      .createQueryBuilder('order')
      .leftJoin('stops', 'stop', 'stop.order_id = order.id')
      .leftJoin('routes', 'route', 'route.id = stop.route_id')
      .leftJoin('users', 'driver_user', 'driver_user.id = route.driver_id')
      .addSelect('driver_user.full_name', 'driverName')
      .addSelect('route.driver_id', 'driverId')
      .where('order.id = :id', { id });

    const { entities, raw } = await qb.getRawAndEntities();
    if (!entities.length) {
      throw new NotFoundException(`Không tìm thấy đơn hàng với ID: ${id}`);
    }
    const order = entities[0];
    const rawItem = (raw as RawOrderWithDriver[])[0];
    const driverName: string | null = rawItem?.driverName ?? rawItem?.driver_user_full_name ?? null;
    const driverId: string | null = rawItem?.driverId ?? rawItem?.route_driver_id ?? null;
    return Object.assign(new Order(), order, {
      driverName,
      driverId,
    });
  }

  /** Creates a single new order */
  async create(dto: CreateOrderDto): Promise<Order> {
    const order = new Order();
    order.id = crypto.randomUUID();
    order.code = this.generateOrderCode();
    order.receiverName = dto.receiverName;
    order.receiverPhone = dto.receiverPhone;
    order.deliveryAddress = dto.deliveryAddress;
    order.weightKg = dto.weightKg ?? 0;
    order.volumeM3 = dto.volumeM3 ?? 0;
    order.codAmount = dto.codAmount ?? 0;
    order.zoneId = dto.zoneId ?? null;
    order.status = OrderStatus.NEW;

    let lat = dto.latitude;
    let lng = dto.longitude;

    if (!lat || !lng || lat === 0 || lng === 0) {
      const depot = await this.depotRepo.findOne({ where: {} });
      const fallbackLat = depot ? Number(depot.latitude) : DEFAULT_DEPOT_LAT;
      const fallbackLng = depot ? Number(depot.longitude) : DEFAULT_DEPOT_LNG;
      const geo = await this.geocodingService.geocodeAddress(
        order.deliveryAddress,
        fallbackLat,
        fallbackLng,
      );
      lat = geo.latitude;
      lng = geo.longitude;
    }

    order.latitude = lat;
    order.longitude = lng;

    const history = new OrderStatusHistory();
    history.orderId = order.id;
    history.status = order.status;
    history.note = 'Tạo đơn hàng thủ công';

    await this.dataSource.transaction(async (manager) => {
      await manager.save(Order, order);
      await manager.save(OrderStatusHistory, history);
    });

    return order;
  }

  /**
   * PATCH /orders/:id/coordinates
   * Updates the delivery coordinates.
   * Forbidden if the order is already DELIVERED.
   */
  async updateCoordinates(id: string, dto: UpdateCoordinatesDto): Promise<Order> {
    const order = await this.findById(id);

    if (order.status === OrderStatus.DELIVERED) {
      throw new BadRequestException(
        'Không thể thay đổi tọa độ của đơn hàng đã được giao thành công (DELIVERED).',
      );
    }

    order.latitude = dto.latitude;
    order.longitude = dto.longitude;
    order.updatedAt = new Date();

    return this.orderRepo.save(order);
  }

  /**
   * Geocode an order's address if lat/lng is missing or zero.
   * Uses the first depot's coordinates as fallback.
   */
  async geocodeOrderIfNeeded(order: Order): Promise<Order> {
    const needsGeocoding =
      !order.latitude ||
      !order.longitude ||
      Number(order.latitude) === 0 ||
      Number(order.longitude) === 0;

    if (!needsGeocoding) return order;

    // Fetch depot fallback
    const depot = await this.depotRepo.findOne({ where: {} });
    const fallbackLat = depot ? Number(depot.latitude) : DEFAULT_DEPOT_LAT;
    const fallbackLng = depot ? Number(depot.longitude) : DEFAULT_DEPOT_LNG;

    const result = await this.geocodingService.geocodeAddress(
      order.deliveryAddress,
      fallbackLat,
      fallbackLng,
    );

    order.latitude = result.latitude;
    order.longitude = result.longitude;
    order.updatedAt = new Date();

    return this.orderRepo.save(order);
  }

  /**
   * Helper to generate unique order code: ORD-YYYYMMDD-XXXX
   */
  private generateOrderCode(): string {
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `ORD-${dateStr}-${randomSuffix}`;
  }

  /**
   * Bulk import orders via Excel
   */
  async importExcel(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file Excel.');
    }

    const workbook = xlsx.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    interface ImportRow {
      receiver_name?: string;
      receiver_phone?: string | number;
      delivery_address?: string;
      weight_kg?: string | number;
      volume_m3?: string | number;
      cod_amount?: string | number;
      zone_id?: string;
      latitude?: string | number;
      longitude?: string | number;
    }
    const rows = xlsx.utils.sheet_to_json<ImportRow>(worksheet);

    const depot = await this.depotRepo.findOne({ where: {} });
    const fallbackLat = depot ? Number(depot.latitude) : DEFAULT_DEPOT_LAT;
    const fallbackLng = depot ? Number(depot.longitude) : DEFAULT_DEPOT_LNG;

    const validRows: { order: Order; history: OrderStatusHistory }[] = [];
    let failedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 2; // Assuming header is row 1

      try {
        if (
          !row.receiver_name ||
          !row.receiver_phone ||
          !row.delivery_address ||
          !row.weight_kg ||
          !row.volume_m3
        ) {
          throw new Error(
            `Dòng ${rowIndex}: Thiếu thông tin bắt buộc (tên, sđt, địa chỉ, khối lượng, thể tích)`,
          );
        }

        const phoneStr = String(row.receiver_phone);
        if (!/^[0-9]{10,11}$/.test(phoneStr)) {
          throw new Error(`Dòng ${rowIndex}: Số điện thoại không hợp lệ (${phoneStr})`);
        }

        const order = new Order();
        order.id = crypto.randomUUID();
        order.code = this.generateOrderCode();
        order.receiverName = String(row.receiver_name);
        order.receiverPhone = phoneStr;
        order.deliveryAddress = String(row.delivery_address);
        order.weightKg = Number(row.weight_kg);
        order.volumeM3 = Number(row.volume_m3);
        order.codAmount = row.cod_amount ? Number(row.cod_amount) : 0;
        order.zoneId = row.zone_id ? String(row.zone_id) : null;
        order.status = OrderStatus.NEW;

        let lat = Number(row.latitude);
        let lng = Number(row.longitude);

        if (!lat || !lng || lat === 0 || lng === 0) {
          const geo = await this.geocodingService.geocodeAddress(
            order.deliveryAddress,
            fallbackLat,
            fallbackLng,
          );
          lat = geo.latitude;
          lng = geo.longitude;
        }

        order.latitude = lat;
        order.longitude = lng;

        const history = new OrderStatusHistory();
        history.orderId = order.id;
        history.status = OrderStatus.NEW;
        history.note = 'Import từ file Excel';

        validRows.push({ order, history });
      } catch (err: unknown) {
        failedCount++;
        errors.push((err as Error).message);
      }
    }

    if (validRows.length > 0) {
      await this.dataSource.transaction(async (manager) => {
        for (const { order, history } of validRows) {
          await manager.save(Order, order);
          await manager.save(OrderStatusHistory, history);
        }
      });
    }

    return {
      totalRows: rows.length,
      importedCount: validRows.length,
      failedCount,
      errors,
    };
  }

  /**
   * Fetch proof of delivery (POD) for an order
   */
  async getOrderPod(orderId: string) {
    const stop = await this.stopRepo.findOne({ where: { orderId } });
    if (!stop) {
      return { hasPod: false };
    }

    const pod = await this.podRepo.findOne({
      where: { stopId: stop.id },
      order: { confirmedAt: 'DESC' },
    });

    if (!pod) {
      return { hasPod: false };
    }

    return {
      hasPod: true,
      photoUrl: pod.photoUrl,
      codCollected: pod.codCollected ? Number(pod.codCollected) : 0,
      failureReason: pod.failureReason,
      confirmedAt: pod.confirmedAt,
    };
  }
}
