import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ZonesService, ZoneWithMetrics } from './zones.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { AssignDriversDto } from './dto/assign-drivers.dto';
import { Driver } from '../entities/driver.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../entities/user.entity';

@Controller('zones')
@Roles(UserRole.ADMIN, UserRole.DISPATCHER)
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  /** GET /api/zones — list all zones with live overload metrics */
  @Get()
  findAll(): Promise<ZoneWithMetrics[]> {
    return this.zonesService.findAll();
  }

  /** GET /api/zones/:id — single zone with live metrics */
  @Get(':id')
  findOne(@Param('id') id: string): Promise<ZoneWithMetrics> {
    return this.zonesService.findOne(id);
  }

  /** POST /api/zones — create a new zone */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateZoneDto): Promise<ZoneWithMetrics> {
    return this.zonesService.create(dto);
  }

  /** PATCH /api/zones/:id — update zone (name, boundary) */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateZoneDto): Promise<ZoneWithMetrics> {
    return this.zonesService.update(id, dto);
  }

  /** DELETE /api/zones/:id — delete zone and safely unlink drivers/orders */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string): Promise<{ success: boolean; deletedId: string }> {
    return this.zonesService.remove(id);
  }

  /** PATCH /api/zones/:id/boundary — update zone GeoJSON boundary */
  @Patch(':id/boundary')
  updateBoundary(
    @Param('id') id: string,
    @Body('boundaryGeoJson') boundaryGeoJson: string | Record<string, unknown>,
  ): Promise<ZoneWithMetrics> {
    return this.zonesService.updateBoundary(id, boundaryGeoJson);
  }

  /**
   * POST /api/zones/:id/drivers
   * Assign one or more drivers to a zone.
   * Idempotent: duplicates are silently ignored.
   */
  @Post(':id/drivers')
  @HttpCode(HttpStatus.OK)
  assignDrivers(@Param('id') id: string, @Body() dto: AssignDriversDto): Promise<ZoneWithMetrics> {
    return this.zonesService.assignDrivers(id, dto);
  }

  /**
   * DELETE /api/zones/:id/drivers/:driverId
   * Remove a specific driver from a zone.
   */
  @Delete(':id/drivers/:driverId')
  @HttpCode(HttpStatus.OK)
  unassignDriver(
    @Param('id') id: string,
    @Param('driverId') driverId: string,
  ): Promise<ZoneWithMetrics> {
    return this.zonesService.unassignDriver(id, driverId);
  }

  /**
   * GET /api/zones/:id/drivers
   * List all assigned drivers for a zone.
   */
  @Get(':id/drivers')
  getAssignedDrivers(@Param('id') id: string): Promise<Driver[]> {
    return this.zonesService.getAssignedDrivers(id);
  }
}
