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
import { DriversService } from './drivers.service';
import {
  CreateDriverDto,
  UpdateDriverDto,
  UpdateShiftStatusDto,
  QueryDriverDto,
} from './dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../entities/user.entity';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  /**
   * GET /api/drivers
   * Paginated list of drivers with vehicle specs and joined user info.
   * Access: ADMIN, DISPATCHER.
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  findAll(@Query() query: QueryDriverDto) {
    return this.driversService.findAll(query);
  }

  /**
   * GET /api/drivers/:userId
   * View vehicle specifications of a driver.
   * Access: ADMIN, DISPATCHER, DRIVER (self only).
   */
  @Get(':userId')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  findByUserId(
    @Param('userId') userId: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.driversService.findByUserId(userId, currentUser);
  }

  /**
   * POST /api/drivers/:userId
   * Configure vehicle specifications for a driver.
   * Access: ADMIN only.
   */
  @Post(':userId')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('userId') userId: string,
    @Body() dto: CreateDriverDto,
  ) {
    return this.driversService.create(userId, dto);
  }

  /**
   * PATCH /api/drivers/:userId
   * Update vehicle specifications (license plate, vehicle type, max weight, max volume).
   * Access: ADMIN only.
   */
  @Patch(':userId')
  @Roles(UserRole.ADMIN)
  update(
    @Param('userId') userId: string,
    @Body() dto: UpdateDriverDto,
  ) {
    return this.driversService.update(userId, dto);
  }

  /**
   * PATCH /api/drivers/:userId/shift-status
   * Update driver shift status (OFFLINE, ONLINE_READY, BUSY).
   * Access: ADMIN, DISPATCHER, DRIVER (self only).
   */
  @Patch(':userId/shift-status')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  updateShiftStatus(
    @Param('userId') userId: string,
    @Body() dto: UpdateShiftStatusDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.driversService.updateShiftStatus(userId, dto, currentUser);
  }

  /**
   * DELETE /api/drivers/:userId
   * Remove vehicle profile of a driver.
   * Access: ADMIN only.
   */
  @Delete(':userId')
  @Roles(UserRole.ADMIN)
  remove(@Param('userId') userId: string) {
    return this.driversService.remove(userId);
  }
}
