import { IsString, IsOptional, MaxLength } from 'class-validator';

export class UpdateZoneDto {
  @IsOptional()
  @IsString({ message: 'Tên khu vực phải là chuỗi ký tự.' })
  @MaxLength(100, { message: 'Tên khu vực không được vượt quá 100 ký tự.' })
  name?: string;

  @IsOptional()
  boundaryGeoJson?: string | Record<string, unknown> | null;
}
