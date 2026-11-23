import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  ParseUUIDPipe,
  ForbiddenException,
} from '@nestjs/common';
import { RoutesService } from './routes.service';
import type { ConfirmRoutesDto, QueryRoutesDto } from './routes.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../entities/user.entity';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

/**
 * Routes Controller — exposes route management APIs under /routes.
 *
 * POST /routes/confirm  → Alias of POST /vrp/confirm (same transactional logic)
 * GET  /routes          → List routes with filters (driverId, status, date)
 * GET  /routes/:id      → Full route detail with ordered stops, driver, depot info
 *
 * All endpoints require JWT authentication.
 * POST /routes/confirm requires DISPATCHER or ADMIN role.
 */
@Controller('routes')
export class RoutesController {
  private readonly logger = new Logger(RoutesController.name);

  constructor(private readonly routesService: RoutesService) {}

  /**
   * POST /routes/confirm
   * Alias endpoint for POST /vrp/confirm.
   * Confirms VRP-optimized routes and persists them atomically.
   *
   * Requires: DISPATCHER or ADMIN role.
   *
   * Body example:
   * {
   *   "routes": [
   *     {
   *       "depotId": "uuid",
   *       "driverId": "uuid",
   *       "totalDistanceKm": 12.5,
   *       "totalEstimatedTimeMin": 95,
   *       "totalWeightKg": 18.3,
   *       "totalVolumeM3": 0.045,
   *       "polyline": [[10.84, 106.67], ...],
   *       "stops": [
   *         { "orderId": "uuid", "sequenceNo": 1, "estimatedArrivalMin": 462 },
   *         { "orderId": "uuid", "sequenceNo": 2, "estimatedArrivalMin": 490 }
   *       ]
   *     }
   *   ]
   * }
   */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DISPATCHER, UserRole.ADMIN)
  async confirm(@Body() dto: ConfirmRoutesDto, @CurrentUser() user: JwtPayload) {
    this.logger.log(
      `POST /routes/confirm by dispatcher=${user?.sub}, routes=${dto.routes?.length ?? 0}`,
    );
    return this.routesService.confirmRoutes(dto, user?.sub);
  }

  /**
   * GET /routes
   * List routes with optional filters.
   * Access: ADMIN, DISPATCHER only.
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async findAll(@Query() query: QueryRoutesDto) {
    return this.routesService.findAll(query);
  }

  /**
   * GET /routes/active
   * Get active route for the currently authenticated driver.
   */
  @Get('active')
  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.DISPATCHER)
  async getActiveRoute(@CurrentUser() user: JwtPayload): Promise<Record<string, unknown>> {
    return this.routesService.getActiveRouteForDriver(user?.sub);
  }

  /**
   * GET /routes/today
   * Alias of /routes/active.
   */
  @Get('today')
  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.DISPATCHER)
  async getTodayRoute(@CurrentUser() user: JwtPayload): Promise<Record<string, unknown>> {
    return this.routesService.getActiveRouteForDriver(user?.sub);
  }

  /**
   * GET /routes/driver/:driverId
   * Get active route for a specific driver by driverId.
   */
  @Get('driver/:driverId')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  async getDriverRoute(
    @Param('driverId') driverId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<Record<string, unknown>> {
    if (user.role === UserRole.DRIVER && user.sub !== driverId) {
      throw new ForbiddenException('Bạn chỉ có thể xem lộ trình của chính mình');
    }
    return this.routesService.getActiveRouteForDriver(driverId);
  }

  /**
   * GET /routes/:id
   * Full route detail: stops in sequence order (1→N), driver profile,
   * depot info, and parsed polyline coordinates.
   */
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
  async findById(
    @Param('id', new ParseUUIDPipe({ version: '4', optional: true })) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const route = (await this.routesService.findById(id)) as { driverId?: string };
    if (user.role === UserRole.DRIVER && route && route.driverId !== user.sub) {
      throw new ForbiddenException('Bạn không có quyền xem lộ trình này');
    }
    return route;
  }
}
