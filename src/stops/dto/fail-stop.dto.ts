import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class FailStopDto {
  @IsNotEmpty({ message: 'action là bắt buộc' })
  @IsIn(['FAILED', 'RESCHEDULED'], {
    message: 'action phải là FAILED hoặc RESCHEDULED',
  })
  action: 'FAILED' | 'RESCHEDULED';

  @IsNotEmpty({ message: 'failureReason là bắt buộc' })
  @IsString({ message: 'failureReason phải là chuỗi' })
  @MaxLength(255, { message: 'failureReason không được vượt quá 255 ký tự' })
  failureReason: string;

  @IsOptional()
  @IsISO8601({}, { message: 'rescheduledDate phải có định dạng ngày hợp lệ (ISO8601)' })
  rescheduledDate?: string;
}
