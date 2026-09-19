import { Controller, Get } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { Driver } from '../entities/driver.entity';

@Controller('drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Get()
  findAll(): Promise<Driver[]> {
    return this.driversService.findAll();
  }
}
