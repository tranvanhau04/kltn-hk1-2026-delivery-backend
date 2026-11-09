import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrackingGateway } from './tracking.gateway';
import { TrackingLog } from '../entities/tracking-log.entity';
import { User } from '../entities/user.entity';

/**
 * SimulationService — Real-time GPS movement simulator for testing
 * the Web Admin Live Socket Map and TrackingMapView.
 *
 * Simulates driver "Văn Hậu Trần" moving along streets in Gò Vấp, TP.HCM
 * every 3 seconds and broadcasting to the 'dispatchers' room.
 */
@Injectable()
export class SimulationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SimulationService.name);
  private intervalTimer: NodeJS.Timeout | null = null;
  private currentIndex = 0;
  private batteryLevel = 95;

  private readonly DRIVER_ID = '2b093939-87b8-47b8-80e3-71ca1884fc12';
  private readonly DRIVER_NAME = 'Văn Hậu Trần';

  // Realistic Waypoints around Go Vap / IUH, HCMC
  private readonly WAYPOINTS: [number, number][] = [
    [10.82753, 106.67931], // Cổng ĐH Công Nghiệp TP.HCM (IUH) - 12 Nguyễn Văn Bảo
    [10.8281, 106.68005], // Ngã 3 Nguyễn Văn Bảo - Nguyễn Thái Sơn
    [10.82915, 106.6812], // Đường Nguyễn Thái Sơn
    [10.8305, 106.6826], // Ngã 4 Nguyễn Thái Sơn - Phan Văn Trị
    [10.8322, 106.6805], // Phan Văn Trị (hướng về Emart)
    [10.8335, 106.6782], // Phan Văn Trị (gần Thống Nhất)
    [10.8351, 106.6751], // Ngã 4 Phan Văn Trị - Quang Trung
    [10.8338, 106.6738], // Đường Quang Trung
    [10.8315, 106.6725], // Vòng xoay Ngã Sáu Gò Vấp
    [10.8295, 106.6748], // Đường Nguyễn Oanh
    [10.8282, 106.6772], // Rẽ vào Nguyễn Văn Bảo
    [10.82753, 106.67931], // Hoàn tất vòng lặp
  ];

  private readonly route: [number, number][];

  constructor(
    private readonly trackingGateway: TrackingGateway,
    @InjectRepository(TrackingLog)
    private readonly trackingLogRepo: Repository<TrackingLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    this.route = this.buildSmoothPath(this.WAYPOINTS, 8);
  }

  onModuleInit() {
    this.logger.log('SimulationService initialized (available for GPS test push)');
  }

  onModuleDestroy() {
    this.stopSimulation();
  }

  /**
   * Start recurring GPS emission every 3 seconds
   */
  startSimulation(intervalMs = 3100): { success: boolean; message: string } {
    if (this.intervalTimer) {
      return { success: true, message: 'Simulation is already running' };
    }

    this.logger.log(`Starting driver GPS simulation for ${this.DRIVER_NAME} (${this.DRIVER_ID})`);
    void this.tick();
    this.intervalTimer = setInterval(() => {
      void this.tick();
    }, intervalMs);

    return { success: true, message: 'Driver GPS simulation started' };
  }

  /**
   * Stop simulation
   */
  stopSimulation(): { success: boolean; message: string } {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
      this.logger.log('Driver GPS simulation stopped');
      return { success: true, message: 'Simulation stopped' };
    }
    return { success: false, message: 'Simulation is not currently active' };
  }

  isRunning(): boolean {
    return this.intervalTimer !== null;
  }

  private async tick() {
    try {
      const [lat, lng] = this.route[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.route.length;

      // Save to tracking_logs for persistent tracking
      const log = this.trackingLogRepo.create({
        driverId: this.DRIVER_ID,
        shiftId: null,
        latitude: lat,
        longitude: lng,
        batteryLevel: this.batteryLevel,
        timestamp: new Date(),
      });
      const savedLog = await this.trackingLogRepo.save(log);

      // Broadcast event to web admin in 'dispatchers' room
      if (this.trackingGateway?.server) {
        const payload = {
          driverId: this.DRIVER_ID,
          fullName: this.DRIVER_NAME,
          latitude: Number(savedLog.latitude),
          longitude: Number(savedLog.longitude),
          batteryLevel: savedLog.batteryLevel,
          shiftId: null,
          timestamp: savedLog.createdAt ?? savedLog.timestamp,
          trackingLogId: savedLog.id,
        };

        this.trackingGateway.server.to('dispatchers').emit('driver_location_updated', payload);
        this.logger.debug(
          `[Simulation] Broadcasted GPS (${lat}, ${lng}) for ${this.DRIVER_NAME} -> dispatchers`,
        );
      }
    } catch (err) {
      this.logger.error('Error during simulation tick:', err);
    }
  }

  private buildSmoothPath(waypoints: [number, number][], stepsPerSegment = 8): [number, number][] {
    const path: [number, number][] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const p1 = waypoints[i];
      const p2 = waypoints[i + 1];
      for (let s = 0; s < stepsPerSegment; s++) {
        const ratio = s / stepsPerSegment;
        const lat = p1[0] + (p2[0] - p1[0]) * ratio;
        const lng = p1[1] + (p2[1] - p1[1]) * ratio;
        path.push([Number(lat.toFixed(6)), Number(lng.toFixed(6))]);
      }
    }
    return path;
  }
}
