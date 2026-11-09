import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Region } from '../entities/region.entity';

@Injectable()
export class RegionsService {
  constructor(
    @InjectRepository(Region)
    private readonly regionRepo: Repository<Region>,
  ) {}

  findAll(): Promise<Region[]> {
    return this.regionRepo.find({
      relations: ['hubs'],
      order: { name: 'ASC' },
    });
  }

  findById(id: string): Promise<Region | null> {
    return this.regionRepo.findOne({
      where: { id },
      relations: ['hubs'],
    });
  }
}
