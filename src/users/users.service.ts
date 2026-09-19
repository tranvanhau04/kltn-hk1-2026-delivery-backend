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
import { v4 as uuidv4 } from 'uuid';
import { User, UserRole, UserStatus } from '../entities/user.entity';
import { Driver } from '../entities/driver.entity';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateUserDto, UpdateUserDto, UpdateRoleDto, UpdateStatusDto, QueryUserDto } from './dto';

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
}
