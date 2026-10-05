import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { Order, OrderStatus } from '../entities/order.entity';
import { Shift, ShiftStatus } from '../entities/shift.entity';
import { Driver, DriverShiftStatus } from '../entities/driver.entity';
import { UserRole } from '../entities/user.entity';
import * as ExcelJS from 'exceljs';
import { ReconcileShiftDto } from './dto/reconcile-shift.dto';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

const mockOrderRepo = {
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockShiftRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockDriverRepo = {
  save: jest.fn(),
};

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getRepositoryToken(Order), useValue: mockOrderRepo },
        { provide: getRepositoryToken(Shift), useValue: mockShiftRepo },
        { provide: getRepositoryToken(Driver), useValue: mockDriverRepo },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  describe('getKpis', () => {
    it('should calculate KPIs correctly including zero-division safety', async () => {
      // Mock 3 orders: 2 Delivered, 1 Failed
      const orders = [
        { status: OrderStatus.DELIVERED, codAmount: 100000, createdAt: new Date() },
        { status: OrderStatus.DELIVERED, codAmount: 150000, createdAt: new Date() },
        { status: OrderStatus.FAILED, codAmount: 200000, createdAt: new Date() },
      ];
      mockOrderRepo.find.mockResolvedValue(orders);
      mockShiftRepo.find.mockResolvedValue([]);

      const result = await service.getKpis('week');

      expect(result.totalOrders).toBe(3);
      expect(result.successOrders).toBe(2);
      expect(result.failedOrders).toBe(1);
      expect(result.successRate).toBe(66.7); // (2/3) * 100 = 66.666... -> 66.7
      expect(result.totalCodCollected).toBe(250000);
      expect(result.shiftOverview).toEqual([]);
    });

    it('should handle zero orders safely', async () => {
      mockOrderRepo.find.mockResolvedValue([]);
      mockShiftRepo.find.mockResolvedValue([]);

      const result = await service.getKpis('week');
      expect(result.totalOrders).toBe(0);
      expect(result.successRate).toBe(0);
      expect(result.totalCodCollected).toBe(0);
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
      mockShiftRepo.findOne.mockResolvedValue(null);
      await expect(service.reconcileShift('uuid', mockDto, mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if already reconciled', async () => {
      mockShiftRepo.findOne.mockResolvedValue({ reconciledAt: new Date() });
      await expect(service.reconcileShift('uuid', mockDto, mockUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should successfully reconcile and update driver status', async () => {
      const shift = {
        id: 'shift-1',
        codCollected: 500000,
        reconciledAt: null,
        driver: { currentShiftStatus: DriverShiftStatus.ONLINE_READY },
      } as unknown as Shift;
      mockShiftRepo.findOne.mockResolvedValue(shift);
      mockShiftRepo.save.mockResolvedValue(shift);
      mockDriverRepo.save.mockResolvedValue(shift.driver);

      const res = await service.reconcileShift('shift-1', mockDto, mockUser);
      expect(res.success).toBe(true);
      expect(shift.codSubmitted).toBe(500000);
      expect(shift.status).toBe(ShiftStatus.CLOSED);
      expect(shift.reconciledBy).toBe(mockUser.sub);
      expect(shift.reconciledAt).not.toBeNull();
      expect(shift.driver.currentShiftStatus).toBe(DriverShiftStatus.OFFLINE);
      expect(mockDriverRepo.save).toHaveBeenCalled();
    });

    it('should include discrepancy message if amounts differ', async () => {
      const shift = { id: 'shift-1', codCollected: 600000, reconciledAt: null };
      mockShiftRepo.findOne.mockResolvedValue(shift);

      const res = await service.reconcileShift('shift-1', mockDto, mockUser);
      expect(res.message).toContain('Thiếu 100000 VNĐ');
    });
  });

  describe('generateExcelExport', () => {
    it('should generate a workbook with 2 sheets', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockShiftRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      mockOrderRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const workbook = await service.generateExcelExport();
      expect(workbook).toBeInstanceOf(ExcelJS.Workbook);
      expect(workbook.worksheets.length).toBe(2);
      expect(workbook.worksheets[0].name).toBe('Tổng quan & Đối soát Ca');
      expect(workbook.worksheets[1].name).toBe('Chi tiết Đơn hàng Giao');
    });
  });
});
