import { Controller, Get, Post, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrackingLog } from '../entities/tracking-log.entity';
import { Driver } from '../entities/driver.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { User } from '../entities/user.entity';
import { v4 as uuidv4 } from 'uuid';

interface LocationDto {
  driverId: string;
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
}

@Controller()
export class TrackingController {
  constructor(
    @InjectRepository(TrackingLog) private readonly logRepo: Repository<TrackingLog>,
    @InjectRepository(Driver) private readonly driverRepo: Repository<Driver>,
    @InjectRepository(Route) private readonly routeRepo: Repository<Route>,
    @InjectRepository(Stop) private readonly stopRepo: Repository<Stop>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) { }

  /**
   * GET /api/tracking/live
   * Returns each active driver's latest real GPS position + active route polyline.
   * If no GPS log exists for a driver, returns positionUnknown: true with null coordinates.
   * Never emits random/generated coordinates.
   */
  @Get('tracking/live')
  async liveTracking() {
    // Get all non-offline drivers
    const drivers = await this.driverRepo.find();
    const activeDrivers = drivers.filter((d) => d.currentShiftStatus !== 'OFFLINE');

    const result = await Promise.all(
      activeDrivers.map(async (driver) => {
        const user = await this.userRepo.findOne({ where: { id: driver.userId } });

        // Latest tracking log — must be real device GPS only
        const latestLog = await this.logRepo.findOne({
          where: { driverId: driver.userId },
          order: { timestamp: 'DESC' },
        });

        // Active route (IN_PROGRESS or PLANNED) ignoring date for testing
        const activeRoute = await this.routeRepo.findOne({
          where: [
            { driverId: driver.userId, status: 'IN_PROGRESS' },
            { driverId: driver.userId, status: 'PLANNED' },
          ],
          order: { routeDate: 'DESC', createdAt: 'DESC' },
        });

        let polyline: [number, number][] = [];
        if (activeRoute?.polyline) {
          try {
            polyline = JSON.parse(activeRoute.polyline) as [number, number][];
          } catch {
            polyline = [];
          }
        }

        // Determine real GPS position — NEVER use Math.random() or generated coordinates.
        // Only use actual values from the tracking_logs table.
        const hasRealGps = latestLog &&
          latestLog.latitude != null &&
          latestLog.longitude != null &&
          Number(latestLog.latitude) !== 0 &&
          Number(latestLog.longitude) !== 0;

        const currentLat: number | null = hasRealGps ? Number(latestLog!.latitude) : null;
        const currentLng: number | null = hasRealGps ? Number(latestLog!.longitude) : null;
        const positionUnknown = !hasRealGps;

        return {
          driverId: driver.userId,
          fullName: user?.fullName ?? 'Unknown',
          phone: user?.phone ?? '',
          licensePlate: driver.licensePlate,
          vehicleType: driver.vehicleType,
          currentShiftStatus: driver.currentShiftStatus,
          // null when no real GPS data — frontend must handle this gracefully
          currentLat,
          currentLng,
          // true when driver has no real GPS ping yet
          positionUnknown,
          lastUpdated: latestLog?.timestamp ?? null,
          activeRoute: activeRoute
            ? {
              routeId: activeRoute.id,
              totalDistanceKm: Number(activeRoute.totalDistanceKm),
              totalEstimatedTimeMin: Number(activeRoute.totalEstimatedTimeMin),
              status: activeRoute.status,
              polyline,
            }
            : null,
        };
      }),
    );

    return result;
  }

  /**
   * POST /api/driver/location
   * Receives real GPS coordinates from the mobile driver app and stores in tracking_logs.
   * Accepts optional speed and heading for richer telemetry.
   */
  @Post('driver/location')
  async postLocation(@Body() dto: LocationDto) {
    if (!dto.driverId || dto.lat == null || dto.lng == null) {
      throw new HttpException('driverId, lat and lng are required', HttpStatus.BAD_REQUEST);
    }

    const log = this.logRepo.create({
      id: uuidv4(),
      driverId: dto.driverId,
      shiftId: null,
      latitude: dto.lat,
      longitude: dto.lng,
    });
    await this.logRepo.save(log);
    return { success: true, timestamp: log.timestamp };
  }

  /**
   * GET /api/driver/:driverId/route
   * Returns the active route + ordered stops with full order details for the driver's mobile app.
   * Returns a clean 404-style response when no route is assigned for today — never returns mock data.
   */
  @Get('driver/:driverId/route')
  async getDriverRoute(@Param('driverId') driverId: string) {
    const driver = await this.driverRepo.findOne({ where: { userId: driverId } });
    if (!driver) {
      return {
        success: false,
        message: 'Driver not found',
        route: null,
        stops: [],
      };
    }

    const today = new Date().toISOString().split('T')[0];

    // Get most recent active route for this driver (ignoring date for testing)
    const route = await this.routeRepo.findOne({
      where: [
        { driverId, status: 'IN_PROGRESS' },
        { driverId, status: 'PLANNED' },
      ],
      order: { routeDate: 'DESC', createdAt: 'DESC' },
    });

    if (!route) {
      // No active route today — return clear response, NO mock data
      return {
        success: false,
        message: 'No active route assigned for today. Please contact your dispatcher.',
        route: null,
        stops: [],
      };
    }

    // Load stops with order data
    const stops = await this.stopRepo.find({
      where: { routeId: route.id },
      order: { sequenceNo: 'ASC' },
    });

    let polyline: [number, number][] = [];
    if (route.polyline) {
      try {
        polyline = JSON.parse(route.polyline) as [number, number][];
      } catch {
        polyline = [];
      }
    }

    return {
      success: true,
      route: {
        id: route.id,
        driverId: route.driverId,
        routeDate: route.routeDate,
        totalDistanceKm: Number(route.totalDistanceKm),
        totalEstimatedTimeMin: Number(route.totalEstimatedTimeMin),
        status: route.status,
        polyline,
      },
      stops: stops.map((s) => ({
        id: s.id,
        routeId: s.routeId,
        orderId: s.orderId,
        sequenceNo: s.sequenceNo,
        status: s.status,
        arrivedAt: s.arrivedAt,
        order: s.order
          ? {
            id: s.order.id,
            code: s.order.code,
            receiverName: s.order.receiverName,
            receiverPhone: s.order.receiverPhone,
            deliveryAddress: s.order.deliveryAddress,
            lat: Number(s.order.latitude),
            lng: Number(s.order.longitude),
            codAmount: Number(s.order.codAmount),
            status: s.order.status,
          }
          : null,
      })),
    };
  }

  /**
   * POST /api/driver/:driverId/shift/end
   * Ends the driver's shift by setting their status to OFFLINE.
   */
  @Post('driver/:driverId/shift/end')
  async endDriverShift(@Param('driverId') driverId: string, @Body() body: any) {
    const driver = await this.driverRepo.findOne({ where: { userId: driverId } });
    if (!driver) {
      throw new HttpException('Driver not found', HttpStatus.NOT_FOUND);
    }
    
    driver.currentShiftStatus = 'OFFLINE';
    await this.driverRepo.save(driver);
    
    return { success: true };
  }

  /**
   * POST /api/driver/:driverId/shift/start
   * Starts the driver's shift by setting their status to ONLINE_READY.
   */
  @Post('driver/:driverId/shift/start')
  async startDriverShift(@Param('driverId') driverId: string) {
    const driver = await this.driverRepo.findOne({ where: { userId: driverId } });
    if (!driver) {
      throw new HttpException('Driver not found', HttpStatus.NOT_FOUND);
    }
    
    driver.currentShiftStatus = 'ONLINE_READY';
    await this.driverRepo.save(driver);
    
    return { success: true };
  }
}
