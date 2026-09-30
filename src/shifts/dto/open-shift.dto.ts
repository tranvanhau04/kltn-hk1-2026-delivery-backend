import { IsNumber, IsOptional, Min } from 'class-validator';

export class OpenShiftDto {
  @IsOptional()
  @IsNumber({}, { message: 'startingCash must be a number' })
  @Min(0, { message: 'startingCash must be >= 0' })
  startingCash?: number;

  @IsOptional()
  @IsNumber({}, { message: 'latitude must be a number' })
  latitude?: number;

  @IsOptional()
  @IsNumber({}, { message: 'longitude must be a number' })
  longitude?: number;
}
