import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateZoneDto {
  @IsString()
  @IsNotEmpty({ message: 'Tên khu vực không được để trống.' })
  @MaxLength(100, { message: 'Tên khu vực không được vượt quá 100 ký tự.' })
  name: string;

  @IsOptional()
  @IsString({ message: 'boundary_geojson phải là chuỗi GeoJSON hợp lệ.' })
  boundaryGeoJson?: string;
}
