import { IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateCoordinatesDto {
  @Type(() => Number)
  @IsNumber({}, { message: 'latitude phải là số thực.' })
  @Min(-90, { message: 'latitude không được nhỏ hơn -90.' })
  @Max(90, { message: 'latitude không được lớn hơn 90.' })
  latitude: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'longitude phải là số thực.' })
  @Min(-180, { message: 'longitude không được nhỏ hơn -180.' })
  @Max(180, { message: 'longitude không được lớn hơn 180.' })
  longitude: number;
}
