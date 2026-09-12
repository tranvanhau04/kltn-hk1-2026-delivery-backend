import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Depot } from '../entities/depot.entity';

@Controller('depots')
export class DepotsController {
  constructor(@InjectRepository(Depot) private readonly depotRepo: Repository<Depot>) {}

  @Get()
  findAll(): Promise<Depot[]> {
    return this.depotRepo.find();
  }
}
