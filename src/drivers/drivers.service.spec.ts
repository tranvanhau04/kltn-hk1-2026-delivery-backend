import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { Driver, DriverShiftStatus } from '../entities/driver.entity';
import { User } from '../entities/user.entity';
import { Depot } from '../entities/depot.entity';
import { Zone } from '../entities/zone.entity';
import { ZoneDriver } from '../entities/zone-driver.entity';
import { Order, OrderStatus } from '../entities/order.entity';
import { Shift, ShiftStatus } from '../entities/shift.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';

describe('DriversService - getFleetInfo', () => {
  let service: DriversService;

  const mockDriver: Partial<Driver> = {
    userId: 'driver-uuid-1',
    licensePlate: '59T1-888.88',
    vehicleType: 'MOTORBIKE',
    maxWeightKg: 60,
    maxVolumeM3: 0.3,
    currentShiftStatus: DriverShiftStatus.ONLINE_READY,
    depotId: 'depot-uuid-1',
    depot: {
      id: 'depot-uuid-1',
      name: 'Hub 01 - Gò Vấp',
      address: '12 Nguyễn Văn Bảo, Gò Vấp',
      contactPhone: '02838940338',
      latitude: 10.822205,
      longitude: 106.687498,
      capacity: 1200,
      regionId: 'region-1',
      region: {} as any,
    },
  };

  const mockDriverRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const mockUserRepo = {
    findOne: jest.fn(),
  };

  const mockDepotRepo = {
    findOne: jest.fn(),
  };

  const mockZoneRepo = {
    findOne: jest.fn(),
  };

  const mockZoneDriverRepo = {
    createQueryBuilder: jest.fn(),
  };

  const mockOrderRepo = {
    find: jest.fn(),
  };

  const mockShiftRepo = {
    findOne: jest.fn(),
  };

  const mockRouteRepo = {
    createQueryBuilder: jest.fn(),
  };

  const mockStopRepo = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriversService,
        { provide: getRepositoryToken(Driver), useValue: mockDriverRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(Depot), useValue: mockDepotRepo },
        { provide: getRepositoryToken(Zone), useValue: mockZoneRepo },
        { provide: getRepositoryToken(ZoneDriver), useValue: mockZoneDriverRepo },
        { provide: getRepositoryToken(Order), useValue: mockOrderRepo },
        { provide: getRepositoryToken(Shift), useValue: mockShiftRepo },
        { provide: getRepositoryToken(Route), useValue: mockRouteRepo },
        { provide: getRepositoryToken(Stop), useValue: mockStopRepo },
      ],
    }).compile();

    service = module.get<DriversService>(DriversService);
    jest.clearAllMocks();
  });

  it('should return complete fleet info with active route, orders, depot and zones', async () => {
    mockDriverRepo.findOne.mockResolvedValue(mockDriver);

    // Mock zone query builder
    const mockZdQb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ name: 'Khu vực Gò Vấp / Bình Thạnh' }]),
    };
    mockZoneDriverRepo.createQueryBuilder.mockReturnValue(mockZdQb);

    // Mock active shift
    mockShiftRepo.findOne.mockResolvedValue({
      id: 'shift-1',
      startTime: new Date('2026-11-15T08:00:00Z'),
      status: ShiftStatus.OPEN,
    });

    // Mock active route query builder
    const mockRouteQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'route-1' }),
    };
    mockRouteRepo.createQueryBuilder.mockReturnValue(mockRouteQb);

    // Mock stops on the route
    mockStopRepo.find.mockResolvedValue([
      {
        id: 'stop-1',
        status: 'COMPLETED',
        order: { weightKg: 5, status: OrderStatus.DELIVERED },
      },
      {
        id: 'stop-2',
        status: 'PENDING',
        order: { weightKg: 10, status: OrderStatus.ASSIGNED },
      },
      {
        id: 'stop-3',
        status: 'ARRIVED',
        order: { weightKg: 8.5, status: OrderStatus.IN_TRANSIT },
      },
    ]);

    const result = await service.getFleetInfo('driver-uuid-1');

    expect(result.success).toBe(true);
    expect(result.driver.licensePlate).toBe('59T1-888.88');
    expect(result.driver.vehicleType).toBe('MOTORBIKE');
    expect(result.driver.maxWeightKg).toBe(60);
    expect(result.depot?.name).toBe('Hub 01 - Gò Vấp');
    expect(result.depot?.contactPhone).toBe('02838940338');
    expect(result.zones).toEqual(['Khu vực Gò Vấp / Bình Thạnh']);
    expect(result.metrics.totalAssignedOrders).toBe(3);
    expect(result.metrics.deliveredOrders).toBe(1);
    expect(result.metrics.remainingOrders).toBe(2);
    expect(result.metrics.currentWeightKg).toBe(18.5);
    expect(result.metrics.totalShiftWeightKg).toBe(23.5);
  });

  it('should handle driver with 0 orders and no active route without error', async () => {
    const freshDriver: Partial<Driver> = {
      userId: 'driver-uuid-2',
      licensePlate: '59A1-123.45',
      vehicleType: 'MOTORBIKE',
      maxWeightKg: 40,
      maxVolumeM3: 0.2,
      currentShiftStatus: DriverShiftStatus.OFFLINE,
      depotId: null,
      depot: null,
    };
    mockDriverRepo.findOne.mockResolvedValue(freshDriver);

    const mockZdQb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    mockZoneDriverRepo.createQueryBuilder.mockReturnValue(mockZdQb);
    mockShiftRepo.findOne.mockResolvedValue(null);

    const mockRouteQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    mockRouteRepo.createQueryBuilder.mockReturnValue(mockRouteQb);
    mockOrderRepo.find.mockResolvedValue([]);

    const result = await service.getFleetInfo('driver-uuid-2');

    expect(result.success).toBe(true);
    expect(result.depot).toBeNull();
    expect(result.zones).toEqual([]);
    expect(result.metrics.currentWeightKg).toBe(0);
    expect(result.metrics.totalShiftWeightKg).toBe(0);
    expect(result.metrics.totalAssignedOrders).toBe(0);
    expect(result.metrics.deliveredOrders).toBe(0);
    expect(result.metrics.remainingOrders).toBe(0);
  });

  it('should throw NotFoundException if driver does not exist', async () => {
    mockDriverRepo.findOne.mockResolvedValue(null);
    await expect(service.getFleetInfo('non-existent')).rejects.toThrow(NotFoundException);
  });
});
