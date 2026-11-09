import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Depot } from '../entities/depot.entity';
import { Public } from '../auth/decorators/public.decorator';

@Controller('depots')
export class DepotsController {
  constructor(@InjectRepository(Depot) private readonly depotRepo: Repository<Depot>) {}

  @Public()
  @Get()
  findAll(@Query('regionId') regionId?: string): Promise<Depot[]> {
    return this.depotRepo.find({
      where: regionId ? { regionId } : {},
      relations: ['region'],
      order: { name: 'ASC' },
    });
  }
}
