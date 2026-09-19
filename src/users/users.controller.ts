import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto, UpdateRoleDto, UpdateStatusDto, QueryUserDto } from './dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../entities/user.entity';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /api/users
   * Paginated list of users with search and filter.
   * Access: ADMIN, DISPATCHER.
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  findAll(@Query() query: QueryUserDto) {
    return this.usersService.findAll(query);
  }

  /**
   * GET /api/users/:id
   * Get single user by ID.
   * Access: ADMIN, DISPATCHER, or DRIVER (self only).
   */
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  findById(@Param('id') id: string, @CurrentUser() currentUser: JwtPayload) {
    return this.usersService.findById(id, currentUser);
  }

  /**
   * POST /api/users
   * Create new user account.
   * Access: ADMIN only.
   */
  @Post()
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  /**
   * PATCH /api/users/:id
   * Update basic profile (fullName, phone).
   * Access: ADMIN only.
   */
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  /**
   * PATCH /api/users/:id/role
   * Update user role (ADMIN, DISPATCHER, DRIVER).
   * Access: ADMIN only (with self-demotion prevention).
   */
  @Patch(':id/role')
  @Roles(UserRole.ADMIN)
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.usersService.updateRole(id, dto, currentUser);
  }

  /**
   * PATCH /api/users/:id/status
   * Update user status (ACTIVE, INACTIVE, LOCKED).
   * Access: ADMIN only (with self-lock prevention).
   */
  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.usersService.updateStatus(id, dto, currentUser);
  }

  /**
   * DELETE /api/users/:id
   * Safe deactivate user by setting status to LOCKED.
   * Access: ADMIN only (with self-deactivation prevention).
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  safeDeactivate(@Param('id') id: string, @CurrentUser() currentUser: JwtPayload) {
    return this.usersService.safeDeactivate(id, currentUser);
  }
}
