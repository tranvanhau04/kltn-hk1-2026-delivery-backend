import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Depot } from '../entities/depot.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../entities/user.entity';

@Controller('depots')
@Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER)
export class DepotsController {
  constructor(@InjectRepository(Depot) private readonly depotRepo: Repository<Depot>) {}

  @Get()
  findAll(@Query('regionId') regionId?: string): Promise<Depot[]> {
    return this.depotRepo.find({
      where: regionId ? { regionId } : {},
      relations: ['region'],
      order: { name: 'ASC' },
    });
  }
}
