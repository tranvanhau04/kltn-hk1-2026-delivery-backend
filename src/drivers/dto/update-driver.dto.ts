import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class UpdateDriverDto {
  @IsOptional()
  @IsString({ message: 'License plate must be a string' })
  @MaxLength(20, { message: 'License plate must not exceed 20 characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : undefined,
  )
  licensePlate?: string;

  @IsOptional()
  @IsString({ message: 'Vehicle type must be a string' })
  @MaxLength(30, { message: 'Vehicle type must not exceed 30 characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : undefined,
  )
  vehicleType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Max weight must be a number with up to 2 decimal places' },
  )
  @Min(0.01, { message: 'Max weight capacity must be greater than 0' })
  maxWeightKg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 3 },
    { message: 'Max volume must be a number with up to 3 decimal places' },
  )
  @Min(0.001, { message: 'Max volume capacity must be greater than 0' })
  maxVolumeM3?: number;
}
