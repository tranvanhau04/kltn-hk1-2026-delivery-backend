import { Controller, Get, Param } from '@nestjs/common';
import { RegionsService } from './regions.service';
import { Region } from '../entities/region.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../entities/user.entity';

@Controller('regions')
@Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
export class RegionsController {
  constructor(private readonly regionsService: RegionsService) {}

  @Get()
  findAll(): Promise<Region[]> {
    return this.regionsService.findAll();
  }

  @Get(':id')
  findById(@Param('id') id: string): Promise<Region | null> {
    return this.regionsService.findById(id);
  }
}
