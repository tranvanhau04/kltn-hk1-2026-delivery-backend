import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { UsersService } from './users.service';
import { User, UserRole, UserStatus } from '../entities/user.entity';
import { Driver } from '../entities/driver.entity';

describe('UsersService - Excel Import & Template', () => {
  let service: UsersService;

  const mockUserRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((dto: Partial<User>) => dto),
    save: jest.fn((user: Partial<User>) => Promise.resolve(user)),
  };

  const mockDriverRepo = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(Driver), useValue: mockDriverRepo },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  it('should generate users Excel template with 5 headers and 2 sample rows', () => {
    const wb = service.generateImportTemplate();
    const sheet = wb.worksheets[0];
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(1).getCell(1).value).toBe('Họ và tên');
    expect(sheet.getRow(1).getCell(4).value).toBe('Vai trò (ADMIN/DISPATCHER/DRIVER)');
    expect(sheet.getRow(1).getCell(5).value).toBe('Mật khẩu (để trống = 123456)');
  });

  it('should import valid users, default blank password to 123456, and report duplicate/invalid rows without aborting', async () => {
    mockUserRepo.find.mockResolvedValue([
      { email: 'existing@smartexpress.vn', phone: '0999888777' },
    ]);

    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Users');
    sheet.addRow([
      'Họ và tên',
      'Email',
      'Số điện thoại',
      'Vai trò (ADMIN/DISPATCHER/DRIVER)',
      'Mật khẩu (để trống = 123456)',
    ]);
    // Row 2: Valid user with hyperlink email & blank password
    sheet.addRow([
      'Nguyễn Văn An',
      { text: 'an.nguyen@smartexpress.vn', hyperlink: 'mailto:an.nguyen@smartexpress.vn' },
      '0901112223',
      'DISPATCHER',
      '',
    ]);
    // Row 3: Duplicate email with Row 2 in same file
    sheet.addRow(['Trần Trùng File', 'an.nguyen@smartexpress.vn', '0903334445', 'DRIVER', '']);
    // Row 4: Duplicate email in DB
    sheet.addRow(['Lê Trùng DB', 'existing@smartexpress.vn', '0905556667', 'ADMIN', '123456']);
    // Row 5: Invalid role
    sheet.addRow(['Phạm Sai Role', 'role.bad@smartexpress.vn', '0907778889', 'MANAGER', '123456']);

    const arrayBuffer = await wb.xlsx.writeBuffer();
    const file = {
      originalname: 'users.xlsx',
      buffer: Buffer.from(arrayBuffer),
    } as Express.Multer.File;

    const result = await service.importExcel(file);
    expect(result.totalRows).toBe(4);
    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(3);
    expect(result.errors.map((e) => e.row)).toEqual([3, 4, 5]);
    expect(mockUserRepo.save).toHaveBeenCalledTimes(1);
    expect(mockUserRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: 'Nguyễn Văn An',
        email: 'an.nguyen@smartexpress.vn',
        phone: '0901112223',
        role: UserRole.DISPATCHER,
        status: UserStatus.ACTIVE,
      }),
    );
  });

  it('should throw BadRequestException if file has no data rows', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Empty');
    sheet.addRow(['Họ và tên', 'Email', 'Số điện thoại', 'Vai trò', 'Mật khẩu']);
    const arrayBuffer = await wb.xlsx.writeBuffer();

    const file = {
      originalname: 'empty.xlsx',
      buffer: Buffer.from(arrayBuffer),
    } as Express.Multer.File;

    await expect(service.importExcel(file)).rejects.toThrow(BadRequestException);
  });
});
