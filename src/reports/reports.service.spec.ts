import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ReportsService } from './reports.service';
import { Order, OrderStatus } from '../entities/order.entity';
import { Shift, ShiftStatus } from '../entities/shift.entity';
import { Driver, DriverShiftStatus } from '../entities/driver.entity';
import { UserRole } from '../entities/user.entity';
import * as ExcelJS from 'exceljs';
import { ReconcileShiftDto } from './dto/reconcile-shift.dto';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

describe('ReportsService', () => {
  let service: ReportsService;

  const mockOrderQb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
    getRawMany: jest.fn(),
    getMany: jest.fn(),
  };

  const mockShiftQb = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawAndEntities: jest.fn(),
  };

  const mockOrderRepo = {
    createQueryBuilder: jest.fn(() => mockOrderQb),
  };

  const mockShiftRepo = {
    createQueryBuilder: jest.fn(() => mockShiftQb),
  };

  const mockDriverRepo = {
    save: jest.fn(),
  };

  const mockEntityManager = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn(async (cb: (manager: typeof mockEntityManager) => Promise<unknown>) => {
      return cb(mockEntityManager);
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getRepositoryToken(Order), useValue: mockOrderRepo },
        { provide: getRepositoryToken(Shift), useValue: mockShiftRepo },
        { provide: getRepositoryToken(Driver), useValue: mockDriverRepo },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  describe('getKpis', () => {
    it('should calculate KPIs correctly via Native SQL Aggregation', async () => {
      // Mock KPI row from SQL aggregation
      mockOrderQb.getRawOne.mockResolvedValue({
        totalOrders: '3',
        successOrders: '2',
        failedOrders: '1',
        totalCodCollected: '250000',
      });

      // Mock weekly trends (e.g. Orders on Mon and Wed)
      mockOrderQb.getRawMany.mockResolvedValue([
        { weekday: 0, count: '2' }, // T2
        { weekday: 2, count: '1' }, // T4
      ]);

      // Mock shift overview
      mockShiftQb.getRawAndEntities.mockResolvedValue({
        entities: [
          {
            id: 'shift-1',
            driverId: 'driver-uuid-1',
            driver: { licensePlate: '51F-123.45' },
            startTime: new Date(),
            endTime: new Date(),
            codCollected: 250000,
            codSubmitted: 250000,
            reconciledBy: 'admin-uuid',
            reconciledAt: new Date(),
          },
        ],
        raw: [
          {
            driverFullName: 'Nguyễn Văn Tài Xế',
          },
        ],
      });

      const result = await service.getKpis('week');

      expect(result.totalOrders).toBe(3);
      expect(result.successOrders).toBe(2);
      expect(result.failedOrders).toBe(1);
      expect(result.successRate).toBe(66.7);
      expect(result.totalCodCollected).toBe(250000);

      // Verify all 7 days are always returned
      expect(result.weeklyOrderTrends).toHaveLength(7);
      expect(result.weeklyOrderTrends.map((d) => d.label)).toEqual([
        'T2',
        'T3',
        'T4',
        'T5',
        'T6',
        'T7',
        'CN',
      ]);
      expect(result.weeklyOrderTrends.find((d) => d.label === 'T2')?.count).toBe(2);
      expect(result.weeklyOrderTrends.find((d) => d.label === 'T3')?.count).toBe(0);
      expect(result.weeklyOrderTrends.find((d) => d.label === 'T4')?.count).toBe(1);

      // Verify real driver name is populated
      expect(result.shiftOverview[0].driverName).toBe('Nguyễn Văn Tài Xế');
      expect(result.shiftOverview[0].licensePlate).toBe('51F-123.45');
    });

    it('should handle zero orders safely with all 7 days with count 0', async () => {
      mockOrderQb.getRawOne.mockResolvedValue({
        totalOrders: '0',
        successOrders: '0',
        failedOrders: '0',
        totalCodCollected: '0',
      });
      mockOrderQb.getRawMany.mockResolvedValue([]);
      mockShiftQb.getRawAndEntities.mockResolvedValue({ entities: [], raw: [] });

      const result = await service.getKpis('week');
      expect(result.totalOrders).toBe(0);
      expect(result.successRate).toBe(0);
      expect(result.totalCodCollected).toBe(0);
      expect(result.weeklyOrderTrends).toHaveLength(7);
      result.weeklyOrderTrends.forEach((item) => {
        expect(item.count).toBe(0);
      });
    });
  });

  describe('reconcileShift', () => {
    const mockUser: JwtPayload = {
      sub: 'admin-uuid',
      role: UserRole.ADMIN,
      email: 'admin@smartexpress.vn',
    };
    const mockDto: ReconcileShiftDto = { submittedAmount: 500000 };

    it('should throw NotFoundException if shift not found', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);
      await expect(service.reconcileShift('uuid', mockDto, mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if already reconciled or closed', async () => {
      mockEntityManager.findOne.mockResolvedValue({
        id: 'uuid',
        status: ShiftStatus.CLOSED,
        reconciledAt: new Date(),
      });
      await expect(service.reconcileShift('uuid', mockDto, mockUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should successfully reconcile with pessimistic lock inside transaction', async () => {
      const shift = {
        id: 'shift-1',
        status: ShiftStatus.PENDING_SETTLEMENT,
        codCollected: 500000,
        reconciledAt: null,
        driver: { currentShiftStatus: DriverShiftStatus.ONLINE_READY },
      } as unknown as Shift;

      mockEntityManager.findOne.mockResolvedValue(shift);
      mockEntityManager.save.mockResolvedValue(shift);

      const res = await service.reconcileShift('shift-1', mockDto, mockUser);

      // Verify transaction was called
      expect(mockDataSource.transaction).toHaveBeenCalled();

      // Verify pessimistic write lock was requested
      expect(mockEntityManager.findOne).toHaveBeenCalledWith(Shift, {
        where: { id: 'shift-1' },
        relations: ['driver'],
        lock: { mode: 'pessimistic_write' },
      });

      expect(res.success).toBe(true);
      expect(shift.codSubmitted).toBe(500000);
      expect(shift.status).toBe(ShiftStatus.CLOSED);
      expect(shift.reconciledBy).toBe(mockUser.sub);
      expect(shift.reconciledAt).not.toBeNull();
      expect(shift.driver.currentShiftStatus).toBe(DriverShiftStatus.OFFLINE);
      expect(mockEntityManager.save).toHaveBeenCalledTimes(2); // shift and driver
    });

    it('should calculate discrepancies accurately for deficit (Thiếu)', async () => {
      const shift = {
        id: 'shift-1',
        status: ShiftStatus.PENDING_SETTLEMENT,
        codCollected: 600000,
        reconciledAt: null,
      };
      mockEntityManager.findOne.mockResolvedValue(shift);

      const res = await service.reconcileShift('shift-1', mockDto, mockUser);
      expect(res.message).toContain('Thiếu 100.000 VNĐ');
    });

    it('should calculate discrepancies accurately for surplus (Dư)', async () => {
      const shift = {
        id: 'shift-1',
        status: ShiftStatus.PENDING_SETTLEMENT,
        codCollected: 400000,
        reconciledAt: null,
      };
      mockEntityManager.findOne.mockResolvedValue(shift);

      const res = await service.reconcileShift('shift-1', mockDto, mockUser);
      expect(res.message).toContain('Dư 100.000 VNĐ');
    });
  });

  describe('generateExcelExport', () => {
    it('should generate a workbook with 2 sheets and real driver names', async () => {
      mockShiftQb.getRawAndEntities.mockResolvedValue({
        entities: [
          {
            id: 'shift-1',
            driverId: 'driver-1',
            startTime: new Date(),
            endTime: new Date(),
            codCollected: 1000000,
            codSubmitted: 1000000,
            reconciledAt: new Date(),
            reconciledBy: 'admin',
            driver: { licensePlate: '51F-999.99' },
          },
        ],
        raw: [{ driverFullName: 'Lê Văn Lái Xe' }],
      });
      mockOrderQb.getMany.mockResolvedValue([
        {
          id: 'order-1',
          zoneId: 'ZONE-A',
          receiverName: 'Nguyễn Thị B',
          receiverPhone: '0912345678',
          deliveryAddress: '123 CMT8, Q3, TP.HCM',
          weightKg: 2.5,
          codAmount: 500000,
          status: OrderStatus.DELIVERED,
          updatedAt: new Date(),
        },
      ]);

      const workbook = await service.generateExcelExport();
      expect(workbook).toBeInstanceOf(ExcelJS.Workbook);
      expect(workbook.worksheets.length).toBe(2);
      expect(workbook.worksheets[0].name).toBe('Tổng quan & Đối soát Ca');
      expect(workbook.worksheets[1].name).toBe('Chi tiết Đơn hàng Giao');

      // Check real driver name in Sheet 1 row 5
      const driverCell = workbook.worksheets[0].getCell('C5').value;
      expect(driverCell).toBe('Lê Văn Lái Xe');
    });
  });
});
