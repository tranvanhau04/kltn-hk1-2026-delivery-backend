import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DriverShiftStatus } from '../../entities/driver.entity';

export class CreateDriverDto {
  @IsNotEmpty({ message: 'License plate is required' })
  @IsString({ message: 'License plate must be a string' })
  @MaxLength(20, { message: 'License plate must not exceed 20 characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : '',
  )
  licensePlate: string;

  @IsNotEmpty({ message: 'Vehicle type is required' })
  @IsString({ message: 'Vehicle type must be a string' })
  @MaxLength(30, { message: 'Vehicle type must not exceed 30 characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : '',
  )
  vehicleType: string;

  @IsNotEmpty({ message: 'Max weight capacity is required' })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Max weight must be a number with up to 2 decimal places' },
  )
  @Min(0.01, { message: 'Max weight capacity must be greater than 0' })
  maxWeightKg: number;

  @IsNotEmpty({ message: 'Max volume capacity is required' })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 3 },
    { message: 'Max volume must be a number with up to 3 decimal places' },
  )
  @Min(0.001, { message: 'Max volume capacity must be greater than 0' })
  maxVolumeM3: number;

  @IsOptional()
  @IsEnum(DriverShiftStatus, {
    message: `Shift status must be one of: ${Object.values(DriverShiftStatus).join(', ')}`,
  })
  currentShiftStatus?: DriverShiftStatus = DriverShiftStatus.OFFLINE;
}
