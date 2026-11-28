import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DriversService } from './drivers.service';
import { Driver } from '../entities/driver.entity';
import {
  CreateDriverDto,
  CreateDriverAccountDto,
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

  @Get('all')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  findAllUnpaginated(): Promise<Driver[]> {
    return this.driversService.findAllUnpaginated();
  }

  /**
   * GET /api/drivers/import/template
   * Generates and streams a sample .xlsx file for bulk driver import.
   * Access: ADMIN, DISPATCHER.
   */
  @Get('import/template')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async downloadImportTemplate(@Res() res: Response) {
    const workbook = await this.driversService.generateImportTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="mau_nhap_tai_xe.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  }

  /**
   * POST /api/drivers/import
   * Bulk import drivers (User + Driver atomically per row) from an uploaded .xlsx / .xls file.
   * Access: ADMIN, DISPATCHER.
   */
  @Post('import')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  importDrivers(@UploadedFile() file: Express.Multer.File) {
    return this.driversService.importExcel(file);
  }

  /**
   * GET /api/drivers/me/earnings
   * View driver earnings & 15% platform commission breakdown (day, week, month).
   * Access: ADMIN, DISPATCHER, DRIVER.
   */
  @Get('me/earnings')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  getMyEarnings(@CurrentUser() currentUser: JwtPayload) {
    return this.driversService.getEarnings(currentUser.sub);
  }

  /**
   * GET /api/drivers/me/account-summary
   * View driver account summary, depot, assigned zones, and monthly performance stats.
   * Access: ADMIN, DISPATCHER, DRIVER.
   */
  @Get('me/account-summary')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  getMyAccountSummary(@CurrentUser() currentUser: JwtPayload) {
    return this.driversService.getAccountSummary(currentUser.sub);
  }

  /**
   * GET /api/drivers/me/shift-history
   * View shift and COD reconciliation history.
   * Access: ADMIN, DISPATCHER, DRIVER.
   */
  @Get('me/shift-history')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  getMyShiftHistory(@CurrentUser() currentUser: JwtPayload) {
    return this.driversService.getShiftHistory(currentUser.sub);
  }

  /**
   * GET /api/drivers/:userId/account-summary
   */
  @Get(':userId/account-summary')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  getAccountSummaryByUserId(
    @Param('userId') userId: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    if (currentUser.role === UserRole.DRIVER && currentUser.sub !== userId) {
      throw new ForbiddenException('Drivers are only allowed to view their own account summary');
    }
    return this.driversService.getAccountSummary(userId);
  }

  /**
   * GET /api/drivers/:userId/shift-history
   */
  @Get(':userId/shift-history')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  getShiftHistoryByUserId(@Param('userId') userId: string, @CurrentUser() currentUser: JwtPayload) {
    if (currentUser.role === UserRole.DRIVER && currentUser.sub !== userId) {
      throw new ForbiddenException('Drivers are only allowed to view their own shift history');
    }
    return this.driversService.getShiftHistory(userId);
  }

  /**
   * GET /api/drivers/:userId/earnings
   * View earnings & commission breakdown for a specific driver.
   * Access: ADMIN, DISPATCHER, DRIVER (self only).
   */
  @Get(':userId/earnings')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  getEarningsByUserId(@Param('userId') userId: string, @CurrentUser() currentUser: JwtPayload) {
    if (currentUser.role === UserRole.DRIVER && currentUser.sub !== userId) {
      throw new ForbiddenException('Drivers are only allowed to view their own earnings');
    }
    return this.driversService.getEarnings(userId);
  }

  /**
   * GET /api/drivers/me/fleet-info
   * View vehicle specifications, assigned depot, operational zones, and shift load metrics for authenticated driver.
   * Access: ADMIN, DISPATCHER, DRIVER.
   */
  @Get('me/fleet-info')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  getMyFleetInfo(@CurrentUser() currentUser: JwtPayload) {
    return this.driversService.getFleetInfo(currentUser.sub);
  }

  /**
   * GET /api/drivers/:userId/fleet-info
   * View vehicle specifications, assigned depot, operational zones, and shift load metrics for a specific driver.
   * Access: ADMIN, DISPATCHER, DRIVER (self only).
   */
  @Get(':userId/fleet-info')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  getFleetInfoByUserId(@Param('userId') userId: string, @CurrentUser() currentUser: JwtPayload) {
    if (currentUser.role === UserRole.DRIVER && currentUser.sub !== userId) {
      throw new ForbiddenException('Drivers are only allowed to view their own fleet info');
    }
    return this.driversService.getFleetInfo(userId);
  }

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
  findByUserId(@Param('userId') userId: string, @CurrentUser() currentUser: JwtPayload) {
    return this.driversService.findByUserId(userId, currentUser);
  }

  /**
   * POST /api/drivers
   * Atomically create a User (strictly role = DRIVER) and Driver vehicle profile in one transaction.
   * Access: ADMIN, DISPATCHER.
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @HttpCode(HttpStatus.CREATED)
  createDriverAccount(@Body() dto: CreateDriverAccountDto) {
    return this.driversService.createDriverAccount(dto);
  }

  /**
   * POST /api/drivers/:userId
   * Configure vehicle specifications for a driver.
   * Access: ADMIN, DISPATCHER.
   */
  @Post(':userId')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @HttpCode(HttpStatus.CREATED)
  create(@Param('userId') userId: string, @Body() dto: CreateDriverDto) {
    return this.driversService.create(userId, dto);
  }

  /**
   * PATCH /api/drivers/:userId
   * Update vehicle specifications (license plate, vehicle type, max weight, max volume).
   * Access: ADMIN, DISPATCHER.
   */
  @Patch(':userId')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  update(@Param('userId') userId: string, @Body() dto: UpdateDriverDto) {
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
