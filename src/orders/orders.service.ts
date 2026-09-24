import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Brackets } from 'typeorm';
import * as xlsx from 'xlsx';
import * as crypto from 'crypto';
import { Order, OrderStatus } from '../entities/order.entity';
import { Depot } from '../entities/depot.entity';
import { OrderStatusHistory } from '../entities/order-status-history.entity';
import { GeocodingService } from '../geocoding/geocoding.service';
import { UpdateCoordinatesDto } from './dto/update-coordinates.dto';
import { QueryOrderDto } from './dto/query-order.dto';

/** Default Hub coordinates (IUH campus, Gò Vấp) used as geocoding fallback */
const DEFAULT_DEPOT_LAT = 10.8468;
const DEFAULT_DEPOT_LNG = 106.6752;

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Depot)
    private readonly depotRepo: Repository<Depot>,
    @InjectRepository(OrderStatusHistory)
    private readonly historyRepo: Repository<OrderStatusHistory>,
    private readonly geocodingService: GeocodingService,
    private readonly dataSource: DataSource,
  ) {}

  /** Returns all orders based on query filters */
  async findAll(query: QueryOrderDto): Promise<{ data: Order[]; total: number }> {
    const { status, zoneId, search, page = 1, limit = 50 } = query;
    const qb = this.orderRepo.createQueryBuilder('order');

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

    const [data, total] = await qb.getManyAndCount();
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
  async findById(id: string): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng với ID: ${id}`);
    }
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
}
