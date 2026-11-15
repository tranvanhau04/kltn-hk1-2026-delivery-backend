import { IsString, IsNumber, IsOptional, IsUUID } from 'class-validator';

export class UpdateOrderDto {
  @IsString()
  @IsOptional()
  receiverName?: string;

  @IsString()
  @IsOptional()
  receiverPhone?: string;

  @IsString()
  @IsOptional()
  deliveryAddress?: string;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsNumber()
  @IsOptional()
  weightKg?: number;

  @IsNumber()
  @IsOptional()
  volumeM3?: number;

  @IsNumber()
  @IsOptional()
  codAmount?: number;

  @IsNumber()
  @IsOptional()
  deliveryFee?: number;

  @IsString()
  @IsOptional()
  senderName?: string;

  @IsString()
  @IsOptional()
  senderPhone?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsUUID()
  @IsOptional()
  zoneId?: string;

  @IsString()
  @IsOptional()
  depotId?: string;
}
