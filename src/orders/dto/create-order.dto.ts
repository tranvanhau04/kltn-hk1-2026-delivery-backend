import { IsString, IsNotEmpty, IsNumber, IsOptional, IsUUID } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  receiverName: string;

  @IsString()
  @IsOptional()
  senderName?: string;

  @IsString()
  @IsOptional()
  senderPhone?: string;

  @IsNumber()
  @IsOptional()
  deliveryFee?: number;

  @IsString()
  @IsNotEmpty()
  receiverPhone: string;

  @IsString()
  @IsNotEmpty()
  deliveryAddress: string;

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

  @IsString()
  @IsOptional()
  notes?: string;

  @IsUUID()
  @IsOptional()
  zoneId?: string;

  @IsOptional()
  @IsString()
  depotId?: string;
}
