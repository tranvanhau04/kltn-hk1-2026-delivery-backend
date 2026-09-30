import { IsNumber, IsOptional, Min } from 'class-validator';

export class CloseShiftDto {
  @IsOptional()
  @IsNumber({}, { message: 'endingCash must be a number' })
  @Min(0, { message: 'endingCash must be >= 0' })
  endingCash?: number;

  @IsOptional()
  @IsNumber({}, { message: 'latitude must be a number' })
  latitude?: number;

  @IsOptional()
  @IsNumber({}, { message: 'longitude must be a number' })
  longitude?: number;
}
