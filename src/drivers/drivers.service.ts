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
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  CreateDriverDto,
  UpdateDriverDto,
  UpdateShiftStatusDto,
  QueryDriverDto,
} from './dto';

@Injectable()
export class DriversService {
  constructor(
    @InjectRepository(Driver)
    private readonly driverRepo: Repository<Driver>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

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
      .select([
        'driver.user_id AS userId',
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
      .getRawMany();

    const formattedData = rawData.map((d) => ({
      userId: d.userId,
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
      throw new ForbiddenException(
        'Drivers are only allowed to view their own vehicle profile',
      );
    }

    const driver = await this.driverRepo.findOne({ where: { userId } });
    if (!driver) {
      throw new NotFoundException(
        `Driver profile with user ID '${userId}' not found`,
      );
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
      throw new BadRequestException(
        'Cannot configure vehicle profile for non-driver user',
      );
    }

    const existingProfile = await this.driverRepo.findOne({ where: { userId } });
    if (existingProfile) {
      throw new ConflictException(
        'Driver vehicle profile already exists. Use PATCH to update.',
      );
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
      throw new NotFoundException(
        `Driver profile with user ID '${userId}' not found`,
      );
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
  async updateShiftStatus(
    userId: string,
    dto: UpdateShiftStatusDto,
    currentUser: JwtPayload,
  ) {
    if (currentUser.role === UserRole.DRIVER && currentUser.sub !== userId) {
      throw new ForbiddenException(
        'Drivers can only update their own shift status',
      );
    }

    const driver = await this.driverRepo.findOne({ where: { userId } });
    if (!driver) {
      throw new NotFoundException(
        `Driver profile with user ID '${userId}' not found`,
      );
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
      throw new NotFoundException(
        `Driver profile with user ID '${userId}' not found`,
      );
    }

    await this.driverRepo.delete({ userId });

    return {
      message: 'Driver vehicle profile successfully removed',
      userId,
    };
  }
}
