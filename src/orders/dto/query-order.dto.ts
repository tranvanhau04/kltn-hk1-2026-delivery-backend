import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus } from '../../entities/order.entity';

export class QueryOrderDto {
  @IsOptional()
  status?: OrderStatus | OrderStatus[];

  @IsOptional()
  @IsString()
  zoneId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}
