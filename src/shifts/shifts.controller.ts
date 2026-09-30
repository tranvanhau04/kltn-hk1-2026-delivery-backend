import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../entities/user.entity';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

/**
 * ShiftsController — exposes driver shift lifecycle APIs.
 *
 * Routes:
 *   POST /shifts/open          → Open a new shift (DRIVER role)
 *   POST /shifts/close         → Close current open shift (DRIVER role)
 *   GET  /driver/active-route  → Active route for the day (DRIVER role)
 *   GET  /driver/shift/summary → Shift summary metrics (DRIVER role)
 *
 * JwtAuthGuard + RolesGuard are applied globally via APP_GUARD in AppModule,
 * so @UseGuards() decorators are not needed here.
 */
@Controller()
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Shift management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * POST /shifts/open  (also aliased as POST /driver/shift/open)
   * Opens a new working shift for the authenticated driver.
   * Idempotent: returns existing open shift if one is already active.
   */
  @Post('shifts/open')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DRIVER)
  openShift(@Body() dto: OpenShiftDto, @CurrentUser() user: JwtPayload) {
    return this.shiftsService.openShift(dto, user);
  }

  /**
   * POST /driver/shift/open  (alias)
   */
  @Post('driver/shift/open')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DRIVER)
  openShiftAlias(@Body() dto: OpenShiftDto, @CurrentUser() user: JwtPayload) {
    return this.shiftsService.openShift(dto, user);
  }

  /**
   * POST /shifts/close
   * Closes the currently-open shift for the authenticated driver.
   */
  @Post('shifts/close')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DRIVER)
  closeShift(@Body() dto: CloseShiftDto, @CurrentUser() user: JwtPayload) {
    return this.shiftsService.closeShift(dto, user);
  }

  /**
   * POST /driver/shift/close  (alias)
   */
  @Post('driver/shift/close')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DRIVER)
  closeShiftAlias(@Body() dto: CloseShiftDto, @CurrentUser() user: JwtPayload) {
    return this.shiftsService.closeShift(dto, user);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Active route
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * GET /driver/active-route
   * Returns the most recent active delivery route for the authenticated driver.
   * Stops are ordered by sequence_no ASC.
   */
  @Get('driver/active-route')
  @Roles(UserRole.DRIVER)
  getActiveRoute(@CurrentUser() user: JwtPayload) {
    return this.shiftsService.getActiveRoute(user);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Shift summary (Mobile Frame 16)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * GET /driver/shift/summary
   * Returns shift status, active shift info, order counters and COD balance.
   */
  @Get('driver/shift/summary')
  @Roles(UserRole.DRIVER)
  getShiftSummary(@CurrentUser() user: JwtPayload) {
    return this.shiftsService.getShiftSummary(user);
  }
}
