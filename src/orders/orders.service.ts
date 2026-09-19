import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { Depot } from '../entities/depot.entity';
import { GeocodingService } from '../geocoding/geocoding.service';
import { UpdateCoordinatesDto } from './dto/update-coordinates.dto';

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
    private readonly geocodingService: GeocodingService,
  ) {}

  /** Returns all orders */
  findAll(): Promise<Order[]> {
    return this.orderRepo.find({ order: { createdAt: 'DESC' } });
  }

  /** Returns orders with status NEW */
  findPool(): Promise<Order[]> {
    return this.orderRepo.find({ where: { status: 'NEW' }, order: { createdAt: 'DESC' } });
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

    if (order.status === 'DELIVERED') {
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
}
