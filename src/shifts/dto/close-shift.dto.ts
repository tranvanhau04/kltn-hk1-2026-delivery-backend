import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CloseShiftDto {
  /** Số tiền COD tài xế tự khai báo nộp về két thủ quỹ */
  @IsNotEmpty({ message: 'codSubmitted là bắt buộc' })
  @IsNumber({}, { message: 'codSubmitted phải là số' })
  @Min(0, { message: 'codSubmitted phải >= 0' })
  codSubmitted: number;

  /** Ghi chú giải trình chênh lệch (nếu có) */
  @IsOptional()
  @IsString({ message: 'notes phải là chuỗi' })
  notes?: string;

  @IsOptional()
  @IsNumber({}, { message: 'latitude phải là số' })
  latitude?: number;

  @IsOptional()
  @IsNumber({}, { message: 'longitude phải là số' })
  longitude?: number;

  /** Field tương thích ngược nếu client cũ truyền endingCash */
  @IsOptional()
  @IsNumber({}, { message: 'endingCash phải là số' })
  @Min(0, { message: 'endingCash phải >= 0' })
  endingCash?: number;
}
