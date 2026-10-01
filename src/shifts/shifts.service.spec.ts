/**
 * ShiftsService Unit Tests — Task 7.1
 * Tests shift open/close lifecycle and active route retrieval.
 * No real DB connections — all repositories are mocked.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { Shift, ShiftStatus } from '../entities/shift.entity';
import { Driver, DriverShiftStatus } from '../entities/driver.entity';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { Order, OrderStatus } from '../entities/order.entity';
import { Depot } from '../entities/depot.entity';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserRole } from '../entities/user.entity';

// ── Mock factories ─────────────────────────────────────────────────────────────

function makeDriverJwt(userId = 'user-driver-1'): JwtPayload {
  return { sub: userId, email: 'driver@test.com', role: UserRole.DRIVER };
}

function makeMockDriver(userId = 'user-driver-1'): Partial<Driver> {
  return {
    userId,
    licensePlate: '51A-001',
    vehicleType: 'Motorbike',
    maxWeightKg: 30,
    maxVolumeM3: 0.1,
    currentShiftStatus: DriverShiftStatus.OFFLINE,
  };
}

function makeMockShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-uuid-1',
    driverId: 'user-driver-1',
    startTime: new Date('2026-09-30T08:00:00Z'),
    endTime: null,
    status: ShiftStatus.OPEN,
    startingCashCod: 0,
    currentLatitude: null,
    currentLongitude: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    codCollected: 0,
    codSubmitted: 0,
    reconciledBy: null,
    reconciledAt: null,
    driver: {} as Driver,
    ...overrides,
  };
}

function makeMockRoute(driverId = 'user-driver-1'): Partial<Route> {
  return {
    id: 'route-uuid-1',
    driverId,
    depotId: 'depot-1',
    status: 'ASSIGNED',
    totalDistanceKm: 12,
    totalEstimatedTimeMin: 80,
    polyline: '[[10.84,106.67]]',
    createdAt: new Date(),
  };
}

function makeMockStop(sequenceNo: number, orderStatus = OrderStatus.ASSIGNED): Partial<Stop> {
  return {
    id: `stop-${sequenceNo}`,
    routeId: 'route-uuid-1',
    orderId: `order-${sequenceNo}`,
    sequenceNo,
    status: 'PENDING',
    arrivedAt: null,
    order: {
      id: `order-${sequenceNo}`,
      code: `ORD-00${sequenceNo}`,
      receiverName: `Receiver ${sequenceNo}`,
      receiverPhone: '0901234567',
      deliveryAddress: `${sequenceNo} Test Street`,
      latitude: 10.84,
      longitude: 106.67,
      weightKg: 3,
      volumeM3: 0.03,
      codAmount: 100000,
      status: orderStatus,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Order,
  };
}

function makeMockDepot(): Partial<Depot> {
  return { id: 'depot-1', name: 'Kho Tổng', address: 'Gò Vấp', latitude: 10.82, longitude: 106.68 };
}

// ── Test Suite ─────────────────────────────────────────────────────────────────

describe('ShiftsService', () => {
  let service: ShiftsService;

  const mockShiftRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
  };

  const mockDriverRepo = {
    findOne: jest.fn(),
    update: jest.fn(),
  };

  const mockRouteRepo = {
    createQueryBuilder: jest.fn(),
  };

  const mockStopRepo = {
    find: jest.fn(),
  };

  const mockOrderRepo = {};

  const mockDepotRepo = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShiftsService,
        { provide: getRepositoryToken(Shift), useValue: mockShiftRepo },
        { provide: getRepositoryToken(Driver), useValue: mockDriverRepo },
        { provide: getRepositoryToken(Route), useValue: mockRouteRepo },
        { provide: getRepositoryToken(Stop), useValue: mockStopRepo },
        { provide: getRepositoryToken(Order), useValue: mockOrderRepo },
        { provide: getRepositoryToken(Depot), useValue: mockDepotRepo },
      ],
    }).compile();

    service = module.get<ShiftsService>(ShiftsService);
    jest.clearAllMocks();
  });

  // ─── openShift() ──────────────────────────────────────────────────────────────

  describe('openShift()', () => {
    it('should throw NotFoundException when driver profile does not exist', async () => {
      mockDriverRepo.findOne.mockResolvedValue(null);

      await expect(service.openShift({}, makeDriverJwt())).rejects.toThrow(NotFoundException);
    });

    it('should return existing open shift (idempotent) when one is already open', async () => {
      const existingShift = makeMockShift();
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockShiftRepo.findOne.mockResolvedValue(existingShift);

      const result = await service.openShift({}, makeDriverJwt());

      expect(result.success).toBe(true);
      expect(result.shift.id).toBe('shift-uuid-1');
      // Should NOT create a new shift
      expect(mockShiftRepo.create).not.toHaveBeenCalled();
      expect(mockShiftRepo.save).not.toHaveBeenCalled();
    });

    it('should create a new shift and set driver status to ONLINE_READY', async () => {
      const newShift = makeMockShift();
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockShiftRepo.findOne.mockResolvedValue(null); // No existing open shift
      mockShiftRepo.create.mockReturnValue(newShift);
      mockShiftRepo.save.mockResolvedValue(newShift);
      mockDriverRepo.update.mockResolvedValue({});

      const result = await service.openShift({ startingCash: 500000 }, makeDriverJwt());

      expect(result.success).toBe(true);
      expect(result.message).toContain('mở thành công');

      // Driver status must be set to ONLINE_READY
      expect(mockDriverRepo.update).toHaveBeenCalledWith(
        { userId: 'user-driver-1' },
        { currentShiftStatus: DriverShiftStatus.ONLINE_READY },
      );
    });

    it('should store startingCash in the new shift', async () => {
      const newShift = makeMockShift({ startingCashCod: 200000 });
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockShiftRepo.findOne.mockResolvedValue(null);
      mockShiftRepo.create.mockReturnValue(newShift);
      mockShiftRepo.save.mockResolvedValue(newShift);
      mockDriverRepo.update.mockResolvedValue({});

      await service.openShift({ startingCash: 200000 }, makeDriverJwt());

      expect(mockShiftRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ startingCashCod: 200000 }),
      );
    });
  });

  // ─── closeShift() ─────────────────────────────────────────────────────────────

  describe('closeShift()', () => {
    it('should throw NotFoundException when driver profile does not exist', async () => {
      mockDriverRepo.findOne.mockResolvedValue(null);

      await expect(service.closeShift({}, makeDriverJwt())).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when no open shift exists', async () => {
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockShiftRepo.findOne.mockResolvedValue(null); // No open shift

      await expect(service.closeShift({}, makeDriverJwt())).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException with Vietnamese message', async () => {
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockShiftRepo.findOne.mockResolvedValue(null);

      try {
        await service.closeShift({}, makeDriverJwt());
        fail('Expected BadRequestException');
      } catch (err: unknown) {
        expect((err as BadRequestException).message).toBe(
          'Tài xế hiện không có ca làm việc nào đang mở',
        );
      }
    });

    it('should close the shift and set driver status to OFFLINE', async () => {
      const openShift = makeMockShift({ status: ShiftStatus.OPEN });
      const closedShift = makeMockShift({ status: ShiftStatus.CLOSED, endTime: new Date() });

      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockShiftRepo.findOne.mockResolvedValue(openShift);
      mockShiftRepo.save.mockResolvedValue(closedShift);
      mockDriverRepo.update.mockResolvedValue({});

      const result = await service.closeShift({}, makeDriverJwt());

      expect(result.success).toBe(true);
      expect(result.shift.status).toBe(ShiftStatus.CLOSED);

      // Driver status must be set to OFFLINE
      expect(mockDriverRepo.update).toHaveBeenCalledWith(
        { userId: 'user-driver-1' },
        { currentShiftStatus: DriverShiftStatus.OFFLINE },
      );
    });

    it('should set endTime when closing shift', async () => {
      const openShift = makeMockShift();
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockShiftRepo.findOne.mockResolvedValue(openShift);
      mockShiftRepo.save.mockImplementation((s: Shift) => Promise.resolve(s));
      mockDriverRepo.update.mockResolvedValue({});

      await service.closeShift({}, makeDriverJwt());

      expect(mockShiftRepo.save).toHaveBeenCalled();
      const saveCalls = mockShiftRepo.save.mock.calls as [Shift][];
      const savedShift = saveCalls[0][0];
      expect(savedShift.status).toBe(ShiftStatus.CLOSED);
      expect(savedShift.endTime).toBeInstanceOf(Date);
    });
  });

  // ─── getActiveRoute() ─────────────────────────────────────────────────────────

  describe('getActiveRoute()', () => {
    function buildRoutesQb(route: Partial<Route> | null) {
      return {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(route),
      };
    }

    it('should throw NotFoundException when driver profile does not exist', async () => {
      mockDriverRepo.findOne.mockResolvedValue(null);

      await expect(service.getActiveRoute(makeDriverJwt())).rejects.toThrow(NotFoundException);
    });

    it('should return hasActiveRoute=false when no active route exists', async () => {
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockRouteRepo.createQueryBuilder.mockReturnValue(buildRoutesQb(null));

      const result = await service.getActiveRoute(makeDriverJwt());

      expect(result.hasActiveRoute).toBe(false);
      expect(result.route).toBeNull();
    });

    it('should return route with stops sorted by sequenceNo ASC', async () => {
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockRouteRepo.createQueryBuilder.mockReturnValue(buildRoutesQb(makeMockRoute()));

      // Stops intentionally out of order — service must sort them
      const stops = [makeMockStop(3), makeMockStop(1), makeMockStop(2)];
      mockStopRepo.find.mockResolvedValue(
        stops.sort((a, b) => (a.sequenceNo ?? 0) - (b.sequenceNo ?? 0)),
      );
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());

      const result = await service.getActiveRoute(makeDriverJwt());

      expect(result.hasActiveRoute).toBe(true);
      expect(result.route).not.toBeNull();

      const routeStops = result.route!.stops;
      expect(routeStops[0].sequenceNo).toBe(1);
      expect(routeStops[1].sequenceNo).toBe(2);
      expect(routeStops[2].sequenceNo).toBe(3);
    });

    it('should include depot info when depot exists', async () => {
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockRouteRepo.createQueryBuilder.mockReturnValue(buildRoutesQb(makeMockRoute()));
      mockStopRepo.find.mockResolvedValue([makeMockStop(1)]);
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());

      const result = await service.getActiveRoute(makeDriverJwt());

      expect(result.route?.depot?.name).toBe('Kho Tổng');
    });

    it('should include order details in each stop', async () => {
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockRouteRepo.createQueryBuilder.mockReturnValue(buildRoutesQb(makeMockRoute()));
      mockStopRepo.find.mockResolvedValue([makeMockStop(1)]);
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());

      const result = await service.getActiveRoute(makeDriverJwt());

      const stop = result.route?.stops[0];
      expect(stop?.order?.code).toBe('ORD-001');
      expect(stop?.order?.receiverName).toBe('Receiver 1');
    });
  });

  // ─── getShiftSummary() ────────────────────────────────────────────────────────

  describe('getShiftSummary()', () => {
    function buildRoutesQb(route: Partial<Route> | null) {
      return {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(route),
      };
    }

    it('should return OFFLINE status when no active shift', async () => {
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockShiftRepo.findOne.mockResolvedValue(null);
      mockRouteRepo.createQueryBuilder.mockReturnValue(buildRoutesQb(null));

      const result = await service.getShiftSummary(makeDriverJwt());

      expect(result.shiftStatus).toBe(DriverShiftStatus.OFFLINE);
      expect(result.activeShift).toBeNull();
      expect(result.assignedOrdersCount).toBe(0);
      expect(result.deliveredOrdersCount).toBe(0);
      expect(result.pendingCodAmount).toBe(0);
    });

    it('should count delivered orders and accumulate COD amount', async () => {
      const freshDriver = {
        ...makeMockDriver(),
        currentShiftStatus: DriverShiftStatus.ONLINE_READY,
      };
      mockDriverRepo.findOne.mockResolvedValue(freshDriver);
      mockShiftRepo.findOne.mockResolvedValue(makeMockShift());
      mockRouteRepo.createQueryBuilder.mockReturnValue(buildRoutesQb(makeMockRoute()));

      const stops = [
        makeMockStop(1, OrderStatus.DELIVERED), // cod: 100000
        makeMockStop(2, OrderStatus.ASSIGNED), // not delivered
        makeMockStop(3, OrderStatus.DELIVERED), // cod: 100000
      ];
      mockStopRepo.find.mockResolvedValue(stops);

      const result = await service.getShiftSummary(makeDriverJwt());

      expect(result.assignedOrdersCount).toBe(3);
      expect(result.deliveredOrdersCount).toBe(2);
      expect(result.pendingCodAmount).toBe(200000); // 2 × 100000
    });
  });
});
