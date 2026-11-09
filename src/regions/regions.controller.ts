import { Controller, Get, Param } from '@nestjs/common';
import { RegionsService } from './regions.service';
import { Region } from '../entities/region.entity';
import { Public } from '../auth/decorators/public.decorator';

@Controller('regions')
export class RegionsController {
  constructor(private readonly regionsService: RegionsService) {}

  @Public()
  @Get()
  findAll(): Promise<Region[]> {
    return this.regionsService.findAll();
  }

  @Public()
  @Get(':id')
  findById(@Param('id') id: string): Promise<Region | null> {
    return this.regionsService.findById(id);
  }
}
