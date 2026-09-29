/**
 * RoutesService Unit Tests — Task 6.2
 * Tests transactional route confirmation logic using TypeORM QueryRunner mocks.
 * No real DB connections — all repositories and DataSource are mocked.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RoutesService, ConfirmRoutesDto } from './routes.service';
import { Route } from '../entities/route.entity';
import { Stop } from '../entities/stop.entity';
import { Order, OrderStatus } from '../entities/order.entity';
import { Driver } from '../entities/driver.entity';
import { Depot } from '../entities/depot.entity';
import { User } from '../entities/user.entity';
import { OrderStatusHistory } from '../entities/order-status-history.entity';

// ── Mock Factories ────────────────────────────────────────────────────────────

function makeMockOrder(id: string, status: OrderStatus = OrderStatus.NEW): Partial<Order> {
  return {
    id,
    code: `ORD-${id.toUpperCase()}`,
    status,
    weightKg: 5,
    volumeM3: 0.01,
    receiverName: 'Test Customer',
    receiverPhone: '0901234567',
    deliveryAddress: 'Test Address',
    latitude: 10.84,
    longitude: 106.67,
    codAmount: 0,
  };
}

function makeMockDepot(id = 'depot-1'): Partial<Depot> {
  return { id, name: 'IUH Hub', address: 'Go Vap', latitude: 10.8468, longitude: 106.6752 };
}

function makeMockDriver(userId = 'driver-1'): Partial<Driver> {
  return {
    userId,
    licensePlate: '51A-001',
    vehicleType: 'Motorbike',
    maxWeightKg: 30,
    maxVolumeM3: 0.1,
    currentShiftStatus: 'ONLINE_READY',
  };
}

function makeMockUser(id = 'driver-1'): Partial<User> {
  return { id, fullName: 'Nguyen Van A', phone: '0901111111', email: 'a@test.com' };
}

// ── QueryRunner mock helpers ──────────────────────────────────────────────────

function buildQueryRunnerMock() {
  return {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      insert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findOne: jest.fn().mockResolvedValue(null),
    },
  };
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('RoutesService', () => {
  let service: RoutesService;
  let mockQueryRunner: ReturnType<typeof buildQueryRunnerMock>;

  const mockOrderRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const mockRouteRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const mockStopRepo = {
    find: jest.fn(),
    count: jest.fn(),
  };
  const mockDriverRepo = {
    findOne: jest.fn(),
  };
  const mockDepotRepo = {
    findOne: jest.fn(),
  };
  const mockUserRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const mockHistoryRepo = {};

  const mockDataSource = {
    createQueryRunner: jest.fn(),
  };

  beforeEach(async () => {
    mockQueryRunner = buildQueryRunnerMock();
    (mockDataSource.createQueryRunner as jest.Mock).mockReturnValue(mockQueryRunner);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutesService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: getRepositoryToken(Route), useValue: mockRouteRepo },
        { provide: getRepositoryToken(Stop), useValue: mockStopRepo },
        { provide: getRepositoryToken(Order), useValue: mockOrderRepo },
        { provide: getRepositoryToken(Driver), useValue: mockDriverRepo },
        { provide: getRepositoryToken(Depot), useValue: mockDepotRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(OrderStatusHistory), useValue: mockHistoryRepo },
      ],
    }).compile();

    service = module.get<RoutesService>(RoutesService);

    // Reset all mocks between tests
    jest.clearAllMocks();
    (mockDataSource.createQueryRunner as jest.Mock).mockReturnValue(mockQueryRunner);
  });

  // ─── confirmRoutes() ───────────────────────────────────────────────────────

  describe('confirmRoutes()', () => {
    const validDto: ConfirmRoutesDto = {
      routes: [
        {
          depotId: 'depot-1',
          driverId: 'driver-1',
          totalDistanceKm: 12.5,
          totalEstimatedTimeMin: 90,
          totalWeightKg: 10,
          totalVolumeM3: 0.02,
          polyline: [[10.84, 106.67], [10.76, 106.66]],
          stops: [
            { orderId: 'order-1', sequenceNo: 1, estimatedArrivalMin: 462 },
            { orderId: 'order-2', sequenceNo: 2, estimatedArrivalMin: 490 },
          ],
        },
      ],
    };

    it('should throw BadRequestException when no routes provided', async () => {
      await expect(service.confirmRoutes({ routes: [] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when order IDs do not exist', async () => {
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockOrderRepo.find.mockResolvedValue([]); // No orders found

      await expect(service.confirmRoutes(validDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when orders are already ASSIGNED', async () => {
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockOrderRepo.find.mockResolvedValue([
        makeMockOrder('order-1', OrderStatus.ASSIGNED),
        makeMockOrder('order-2', OrderStatus.NEW),
      ]);

      await expect(service.confirmRoutes(validDto)).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when duplicate order IDs across routes', async () => {
      const dtoWithDup: ConfirmRoutesDto = {
        routes: [
          {
            depotId: 'depot-1',
            driverId: 'driver-1',
            totalDistanceKm: 5,
            totalEstimatedTimeMin: 30,
            polyline: [],
            stops: [
              { orderId: 'order-1', sequenceNo: 1 },
              { orderId: 'order-1', sequenceNo: 2 }, // DUPLICATE
            ],
          },
        ],
      };

      await expect(service.confirmRoutes(dtoWithDup)).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when depot does not exist', async () => {
      mockOrderRepo.find.mockResolvedValue([
        makeMockOrder('order-1'),
        makeMockOrder('order-2'),
      ]);
      mockDepotRepo.findOne.mockResolvedValue(null); // Depot not found

      await expect(service.confirmRoutes(validDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when driver does not exist', async () => {
      mockOrderRepo.find.mockResolvedValue([
        makeMockOrder('order-1'),
        makeMockOrder('order-2'),
      ]);
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());
      mockDriverRepo.findOne.mockResolvedValue(null); // Driver not found

      await expect(service.confirmRoutes(validDto)).rejects.toThrow(NotFoundException);
    });

    it('should successfully confirm routes and return routeIds', async () => {
      mockOrderRepo.find.mockResolvedValue([
        makeMockOrder('order-1'),
        makeMockOrder('order-2'),
      ]);
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockQueryRunner.manager.findOne.mockResolvedValue(makeMockUser());

      const result = await service.confirmRoutes(validDto, 'dispatcher-1');

      expect(result.routeIds).toHaveLength(1);
      expect(result.routes).toHaveLength(1);
      expect(result.routes[0].stopCount).toBe(2);
      expect(result.routes[0].driverId).toBe('driver-1');
      expect(result.message).toContain('confirmed');
    });

    it('should call commitTransaction on success', async () => {
      mockOrderRepo.find.mockResolvedValue([
        makeMockOrder('order-1'),
        makeMockOrder('order-2'),
      ]);
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockQueryRunner.manager.findOne.mockResolvedValue(makeMockUser());

      await service.confirmRoutes(validDto, 'dispatcher-1');

      expect(mockQueryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
    });

    it('should call rollbackTransaction and release queryRunner on failure', async () => {
      mockOrderRepo.find.mockResolvedValue([
        makeMockOrder('order-1'),
        makeMockOrder('order-2'),
      ]);
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());

      // Simulate DB insert failure mid-transaction
      mockQueryRunner.manager.insert.mockRejectedValue(new Error('DB constraint violation'));

      await expect(service.confirmRoutes(validDto)).rejects.toThrow('DB constraint violation');

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
    });

    it('should always release queryRunner even when rollback fails', async () => {
      mockOrderRepo.find.mockResolvedValue([
        makeMockOrder('order-1'),
        makeMockOrder('order-2'),
      ]);
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockQueryRunner.manager.insert.mockRejectedValue(new Error('insert error'));
      mockQueryRunner.rollbackTransaction.mockRejectedValue(new Error('rollback error'));

      await expect(service.confirmRoutes(validDto)).rejects.toThrow();
      // release must be called in finally regardless
      expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('should call manager.insert for route, stops, and order history', async () => {
      mockOrderRepo.find.mockResolvedValue([
        makeMockOrder('order-1'),
        makeMockOrder('order-2'),
      ]);
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockQueryRunner.manager.findOne.mockResolvedValue(makeMockUser());

      await service.confirmRoutes(validDto, 'dispatcher-1');

      // insert calls: 1 route + 2 stops + 2 audit histories = 5
      expect(mockQueryRunner.manager.insert).toHaveBeenCalledTimes(5);
    });

    it('should call manager.update for orders and driver shift status', async () => {
      mockOrderRepo.find.mockResolvedValue([
        makeMockOrder('order-1'),
        makeMockOrder('order-2'),
      ]);
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockQueryRunner.manager.findOne.mockResolvedValue(makeMockUser());

      await service.confirmRoutes(validDto, 'dispatcher-1');

      // 2 updates: bulk order status + driver shift status
      expect(mockQueryRunner.manager.update).toHaveBeenCalledTimes(2);

      // First update: orders status -> ASSIGNED
      const [orderEntity, , orderUpdate] = mockQueryRunner.manager.update.mock.calls[0];
      expect(orderEntity).toBe(Order);
      expect(orderUpdate.status).toBe(OrderStatus.ASSIGNED);

      // Second update: driver shift status -> BUSY
      const [driverEntity, , driverUpdate] = mockQueryRunner.manager.update.mock.calls[1];
      expect(driverEntity).toBe(Driver);
      expect(driverUpdate.currentShiftStatus).toBe('BUSY');
    });

    it('should generate route code matching ROT-YYYYMMDD-XXXXXX pattern', async () => {
      mockOrderRepo.find.mockResolvedValue([makeMockOrder('order-1'), makeMockOrder('order-2')]);
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockQueryRunner.manager.findOne.mockResolvedValue(makeMockUser());

      const result = await service.confirmRoutes(validDto, 'dispatcher-1');
      expect(result.routes[0].routeCode).toMatch(/^ROT-\d{8}-[A-F0-9]{6}$/);
    });

    it('should handle multiple routes in one confirm call atomically', async () => {
      const multiRouteDto: ConfirmRoutesDto = {
        routes: [
          {
            depotId: 'depot-1',
            driverId: 'driver-1',
            totalDistanceKm: 10,
            totalEstimatedTimeMin: 60,
            polyline: [],
            stops: [{ orderId: 'order-1', sequenceNo: 1 }],
          },
          {
            depotId: 'depot-1',
            driverId: 'driver-2',
            totalDistanceKm: 15,
            totalEstimatedTimeMin: 80,
            polyline: [],
            stops: [{ orderId: 'order-2', sequenceNo: 1 }],
          },
        ],
      };

      mockOrderRepo.find.mockResolvedValue([
        makeMockOrder('order-1'),
        makeMockOrder('order-2'),
      ]);
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockQueryRunner.manager.findOne.mockResolvedValue(makeMockUser());

      const result = await service.confirmRoutes(multiRouteDto, 'dispatcher-1');
      expect(result.routeIds).toHaveLength(2);
      expect(result.routes).toHaveLength(2);
      // Only ONE transaction for all routes
      expect(mockQueryRunner.startTransaction).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    });
  });

  // ─── findAll() ────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('should return paginated routes with enriched driver info', async () => {
      const mockRoute = {
        id: 'route-1',
        driverId: 'driver-1',
        depotId: 'depot-1',
        routeDate: '2026-09-29',
        totalDistanceKm: 10,
        totalEstimatedTimeMin: 60,
        status: 'PLANNED',
        polyline: '[[10.84,106.67]]',
        createdAt: new Date(),
      };
      const qbMock = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockRoute], 1]),
      };
      mockRouteRepo.createQueryBuilder.mockReturnValue(qbMock);
      mockUserRepo.findOne.mockResolvedValue(makeMockUser());
      mockStopRepo.count.mockResolvedValue(3);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect((result.data[0] as any).driverName).toBe('Nguyen Van A');
      expect((result.data[0] as any).stopCount).toBe(3);
    });
  });

  // ─── findById() ───────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('should throw NotFoundException when route does not exist', async () => {
      mockRouteRepo.findOne.mockResolvedValue(null);
      await expect(service.findById('non-existent-id')).rejects.toThrow(NotFoundException);
    });

    it('should return route detail with stops in sequence order', async () => {
      const mockRoute = {
        id: 'route-1',
        driverId: 'driver-1',
        depotId: 'depot-1',
        routeDate: '2026-09-29',
        totalDistanceKm: 10,
        totalEstimatedTimeMin: 60,
        status: 'PLANNED',
        polyline: '[[10.84,106.67]]',
        createdAt: new Date(),
      };
      const mockStop = {
        id: 'stop-1',
        routeId: 'route-1',
        orderId: 'order-1',
        sequenceNo: 1,
        status: 'PENDING',
        arrivedAt: null,
        order: makeMockOrder('order-1'),
      };
      mockRouteRepo.findOne.mockResolvedValue(mockRoute);
      mockStopRepo.find.mockResolvedValue([mockStop]);
      mockUserRepo.findOne.mockResolvedValue(makeMockUser());
      mockDriverRepo.findOne.mockResolvedValue(makeMockDriver());
      mockDepotRepo.findOne.mockResolvedValue(makeMockDepot());

      const result = await service.findById('route-1') as any;

      expect(result.id).toBe('route-1');
      expect(result.stops).toHaveLength(1);
      expect(result.stops[0].sequenceNo).toBe(1);
      expect(result.driver.fullName).toBe('Nguyen Van A');
      expect(result.depot.name).toBe('IUH Hub');
      expect(result.polyline).toEqual([[10.84, 106.67]]);
    });
  });
});
