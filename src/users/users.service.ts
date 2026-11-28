import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as ExcelJS from 'exceljs';
import * as xlsx from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { User, UserRole, UserStatus } from '../entities/user.entity';
import { Driver } from '../entities/driver.entity';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateUserDto, UpdateUserDto, UpdateRoleDto, UpdateStatusDto, QueryUserDto } from './dto';

export interface ExcelImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface ExcelImportResult {
  totalRows: number;
  successCount: number;
  failedCount: number;
  errors: ExcelImportRowError[];
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const VN_PHONE_REGEX = /^(0|\+84)[35789][0-9]{8}$/;

function extractCellString(value: ExcelJS.CellValue, preservePhoneLeadingZero = false): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    const numStr = String(value).trim();
    if (preservePhoneLeadingZero && /^[35789][0-9]{8}$/.test(numStr)) {
      return `0${numStr}`;
    }
    return numStr;
  }
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') {
      return value.text.trim();
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) => (typeof part.text === 'string' ? part.text : ''))
        .join('')
        .trim();
    }
    if ('result' in value && value.result !== undefined && value.result !== null) {
      if (typeof value.result === 'object' && 'error' in value.result) {
        return '';
      }
      return extractCellString(value.result, preservePhoneLeadingZero);
    }
  }
  return '';
}

function normalizeHeaderKey(rawHeader: string): string {
  return rawHeader
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Driver)
    private readonly driverRepo: Repository<Driver>,
  ) {}

  /**
   * Get paginated users with filtering and search.
   */
  async findAll(query: QueryUserDto) {
    const page = query.page && query.page > 0 ? Number(query.page) : 1;
    const limit = query.limit && query.limit > 0 ? Number(query.limit) : 10;
    const skip = (page - 1) * limit;

    const queryBuilder = this.userRepo.createQueryBuilder('user');

    if (query.role) {
      queryBuilder.andWhere('user.role = :role', { role: query.role });
    }

    if (query.status) {
      queryBuilder.andWhere('user.status = :status', { status: query.status });
    }

    if (query.search && query.search.trim()) {
      const searchTerm = `%${query.search.trim()}%`;
      queryBuilder.andWhere(
        '(user.fullName LIKE :search OR user.email LIKE :search OR user.phone LIKE :search)',
        { search: searchTerm },
      );
    }

    queryBuilder.orderBy('user.createdAt', 'DESC').skip(skip).take(limit);

    const [users, total] = await queryBuilder.getManyAndCount();

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find user by ID with object-level authorization for DRIVER role.
   */
  async findById(id: string, currentUser: JwtPayload) {
    // Object-level authorization: Driver can only view their own user profile
    if (currentUser.role === UserRole.DRIVER && currentUser.sub !== id) {
      throw new ForbiddenException('Drivers are only allowed to view their own profile');
    }

    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID '${id}' not found`);
    }

    // If user is a driver, attach driver vehicle info if present
    if (user.role === UserRole.DRIVER) {
      const driverProfile = await this.driverRepo.findOne({ where: { userId: id } });
      return {
        ...user,
        driverProfile: driverProfile || null,
      };
    }

    return user;
  }

  /**
   * Create a new user account (Admin only).
   */
  async create(dto: CreateUserDto) {
    const existingEmail = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existingEmail) {
      throw new ConflictException('Email already in use');
    }

    const existingPhone = await this.userRepo.findOne({ where: { phone: dto.phone } });
    if (existingPhone) {
      throw new ConflictException('Phone number already in use');
    }

    const rawPassword = dto.password || 'SmartExpress@2026';
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    const user = this.userRepo.create({
      id: uuidv4(),
      fullName: dto.fullName,
      email: dto.email,
      phone: dto.phone,
      passwordHash,
      role: dto.role,
      status: UserStatus.ACTIVE,
    });

    const savedUser = await this.userRepo.save(user);

    // Return sanitized user without passwordHash
    const result = { ...savedUser };
    delete (result as Partial<User>).passwordHash;
    return result;
  }

  /**
   * Update basic user information (fullName, phone).
   */
  async update(id: string, dto: UpdateUserDto) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID '${id}' not found`);
    }

    if (dto.phone && dto.phone !== user.phone) {
      const existingPhone = await this.userRepo.findOne({
        where: { phone: dto.phone, id: Not(id) },
      });
      if (existingPhone) {
        throw new ConflictException('Phone number already in use by another user');
      }
      user.phone = dto.phone;
    }

    if (dto.fullName) {
      user.fullName = dto.fullName;
    }

    return await this.userRepo.save(user);
  }

  /**
   * Update user role (Admin only).
   * Prevents self-demotion.
   */
  async updateRole(id: string, dto: UpdateRoleDto, currentUser: JwtPayload) {
    if (currentUser.sub === id && dto.role !== UserRole.ADMIN) {
      throw new BadRequestException('You cannot demote your own admin account');
    }

    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID '${id}' not found`);
    }

    user.role = dto.role;
    return await this.userRepo.save(user);
  }

  /**
   * Update user status (Admin only).
   * Prevents self-locking or deactivating.
   */
  async updateStatus(id: string, dto: UpdateStatusDto, currentUser: JwtPayload) {
    if (currentUser.sub === id && dto.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('You cannot lock or deactivate your own account');
    }

    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID '${id}' not found`);
    }

    user.status = dto.status;
    return await this.userRepo.save(user);
  }

  /**
   * Safe Deactivate user by setting status to LOCKED (Admin only).
   * Prevents self-deactivation.
   */
  async safeDeactivate(id: string, currentUser: JwtPayload) {
    if (currentUser.sub === id) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID '${id}' not found`);
    }

    user.status = UserStatus.LOCKED;
    const updated = await this.userRepo.save(user);

    return {
      message: 'User successfully deactivated (status set to LOCKED)',
      user: updated,
    };
  }

  /**
   * Generates a sample .xlsx workbook for Users bulk import.
   */
  generateImportTemplate(): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SmartExpress Admin';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Users Import');
    sheet.columns = [
      { header: 'Họ và tên', key: 'fullName', width: 28 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Số điện thoại', key: 'phone', width: 18, style: { numFmt: '@' } },
      { header: 'Vai trò (ADMIN/DISPATCHER/DRIVER)', key: 'role', width: 34 },
      {
        header: 'Mật khẩu (để trống = 123456)',
        key: 'password',
        width: 30,
        style: { numFmt: '@' },
      },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.height = 26;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F172A' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });

    sheet.addRow({
      fullName: 'Nguyễn Minh Quân',
      email: 'quan.nguyen@smartexpress.vn',
      phone: '0901234567',
      role: 'DISPATCHER',
      password: '',
    });

    sheet.addRow({
      fullName: 'Trần Thị Thu Hà',
      email: 'ha.tran@smartexpress.vn',
      phone: '0912345678',
      role: 'ADMIN',
      password: '123456',
    });

    return workbook;
  }

  /**
   * Bulk imports users sequentially from an Excel (.xlsx / .xls) file.
   * Never aborts the entire batch on a single bad row.
   */
  async importExcel(file: Express.Multer.File): Promise<ExcelImportResult> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Vui lòng tải lên file Excel (.xlsx hoặc .xls) hợp lệ.');
    }

    const originalName = (file.originalname || '').toLowerCase().trim();
    if (!originalName.endsWith('.xlsx') && !originalName.endsWith('.xls')) {
      throw new BadRequestException(
        'Định dạng file không hợp lệ. Chỉ chấp nhận file .xlsx hoặc .xls.',
      );
    }

    const workbook = new ExcelJS.Workbook();
    try {
      let xlsxBuffer: Buffer = file.buffer;
      if (originalName.endsWith('.xls') && !originalName.endsWith('.xlsx')) {
        const legacyWb = xlsx.read(file.buffer, { type: 'buffer' });
        xlsxBuffer = xlsx.write(legacyWb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      }
      await workbook.xlsx.load(xlsxBuffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException(
        'Không thể đọc nội dung file Excel. Vui lòng kiểm tra lại định dạng file.',
      );
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      throw new BadRequestException('File Excel không có dữ liệu người dùng để nhập.');
    }

    // Resolve column indices from header row (with positional fallback 1..5)
    const colMap = {
      fullName: 1,
      email: 2,
      phone: 3,
      role: 4,
      password: 5,
    };

    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      const normalized = normalizeHeaderKey(extractCellString(cell.value));
      if (
        normalized.includes('ho va ten') ||
        normalized.includes('ho ten') ||
        normalized === 'fullname' ||
        normalized === 'full_name'
      ) {
        colMap.fullName = colNumber;
      } else if (normalized.includes('email')) {
        colMap.email = colNumber;
      } else if (
        normalized.includes('so dien thoai') ||
        normalized.includes('dien thoai') ||
        normalized === 'phone' ||
        normalized === 'sdt'
      ) {
        colMap.phone = colNumber;
      } else if (normalized.includes('vai tro') || normalized.startsWith('role')) {
        colMap.role = colNumber;
      } else if (normalized.includes('mat khau') || normalized.startsWith('password')) {
        colMap.password = colNumber;
      }
    });

    // Collect non-empty data rows (row >= 2)
    const dataRows: Array<{
      rowNumber: number;
      fullName: string;
      email: string;
      phone: string;
      roleRaw: string;
      passwordRaw: string;
    }> = [];

    for (let r = 2; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      const fullName = extractCellString(row.getCell(colMap.fullName).value);
      const email = extractCellString(row.getCell(colMap.email).value).toLowerCase();
      const phone = extractCellString(row.getCell(colMap.phone).value, true);
      const roleRaw = extractCellString(row.getCell(colMap.role).value).toUpperCase();
      const passwordRaw = extractCellString(row.getCell(colMap.password).value);

      if (!fullName && !email && !phone && !roleRaw && !passwordRaw) {
        continue;
      }

      dataRows.push({ rowNumber: r, fullName, email, phone, roleRaw, passwordRaw });
    }

    if (dataRows.length === 0) {
      throw new BadRequestException(
        'File Excel không có dòng dữ liệu nào hợp lệ (tất cả các dòng đều trống).',
      );
    }

    // Preload existing emails and phones from DB
    const existingUsers = await this.userRepo.find({ select: ['email', 'phone'] });
    const dbEmails = new Set(existingUsers.map((u) => (u.email || '').trim().toLowerCase()));
    const dbPhones = new Set(existingUsers.map((u) => (u.phone || '').trim()));

    const seenEmails = new Map<string, number>();
    const seenPhones = new Map<string, number>();
    const validRoles = new Set<string>(Object.values(UserRole));

    let successCount = 0;
    let failedCount = 0;
    const errors: ExcelImportRowError[] = [];

    for (const item of dataRows) {
      const { rowNumber, fullName, email, phone, roleRaw, passwordRaw } = item;

      // Track intra-file duplicates first so subsequent rows report exact duplicate row
      const prevEmailRow = email ? seenEmails.get(email) : undefined;
      if (email && prevEmailRow === undefined) {
        seenEmails.set(email, rowNumber);
      }

      const prevPhoneRow = phone ? seenPhones.get(phone) : undefined;
      if (phone && prevPhoneRow === undefined) {
        seenPhones.set(phone, rowNumber);
      }

      if (!fullName) {
        failedCount++;
        errors.push({ row: rowNumber, field: 'fullName', message: 'Thiếu Họ và tên.' });
        continue;
      }
      if (fullName.length > 100) {
        failedCount++;
        errors.push({
          row: rowNumber,
          field: 'fullName',
          message: 'Họ và tên không được vượt quá 100 ký tự.',
        });
        continue;
      }

      if (!email) {
        failedCount++;
        errors.push({ row: rowNumber, field: 'email', message: 'Thiếu địa chỉ Email.' });
        continue;
      }
      if (email.length > 150 || !EMAIL_REGEX.test(email)) {
        failedCount++;
        errors.push({
          row: rowNumber,
          field: 'email',
          message: `Email '${email}' không đúng định dạng.`,
        });
        continue;
      }
      if (prevEmailRow !== undefined) {
        failedCount++;
        errors.push({
          row: rowNumber,
          field: 'email',
          message: `Email '${email}' bị trùng với dòng ${prevEmailRow} trong cùng file Excel.`,
        });
        continue;
      }
      if (dbEmails.has(email)) {
        failedCount++;
        errors.push({
          row: rowNumber,
          field: 'email',
          message: `Email '${email}' đã tồn tại trong hệ thống.`,
        });
        continue;
      }

      if (!phone) {
        failedCount++;
        errors.push({ row: rowNumber, field: 'phone', message: 'Thiếu Số điện thoại.' });
        continue;
      }
      if (!VN_PHONE_REGEX.test(phone)) {
        failedCount++;
        errors.push({
          row: rowNumber,
          field: 'phone',
          message: `Số điện thoại '${phone}' không hợp lệ (cần 10 số di động VN bắt đầu bằng 03, 05, 07, 08, 09).`,
        });
        continue;
      }
      if (prevPhoneRow !== undefined) {
        failedCount++;
        errors.push({
          row: rowNumber,
          field: 'phone',
          message: `Số điện thoại '${phone}' bị trùng với dòng ${prevPhoneRow} trong cùng file Excel.`,
        });
        continue;
      }
      if (dbPhones.has(phone)) {
        failedCount++;
        errors.push({
          row: rowNumber,
          field: 'phone',
          message: `Số điện thoại '${phone}' đã tồn tại trong hệ thống.`,
        });
        continue;
      }

      if (!roleRaw || !validRoles.has(roleRaw)) {
        failedCount++;
        errors.push({
          row: rowNumber,
          field: 'role',
          message: `Vai trò '${roleRaw || '(trống)'}' không hợp lệ. Chỉ chấp nhận: ADMIN, DISPATCHER, DRIVER.`,
        });
        continue;
      }

      const finalPassword = passwordRaw || '123456';
      if (finalPassword.length < 6) {
        failedCount++;
        errors.push({
          row: rowNumber,
          field: 'password',
          message: 'Mật khẩu phải có ít nhất 6 ký tự (hoặc để trống để dùng mặc định 123456).',
        });
        continue;
      }

      try {
        const passwordHash = await bcrypt.hash(finalPassword, 10);
        const user = this.userRepo.create({
          id: uuidv4(),
          fullName,
          email,
          phone,
          passwordHash,
          role: roleRaw as UserRole,
          status: UserStatus.ACTIVE,
        });
        await this.userRepo.save(user);

        dbEmails.add(email);
        dbPhones.add(phone);
        successCount++;
      } catch (err: unknown) {
        failedCount++;
        errors.push({
          row: rowNumber,
          message:
            err instanceof Error ? `Lỗi lưu dữ liệu: ${err.message}` : 'Không thể lưu người dùng.',
        });
      }
    }

    return {
      totalRows: dataRows.length,
      successCount,
      failedCount,
      errors,
    };
  }
}
