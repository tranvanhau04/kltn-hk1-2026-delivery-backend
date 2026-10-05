import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SubmitPodDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'codCollected phải là một số hợp lệ' })
  @Min(0, { message: 'codCollected không được nhỏ hơn 0' })
  codCollected?: number;

  @IsOptional()
  @IsString({ message: 'notes phải là chuỗi' })
  @MaxLength(255, { message: 'notes không được vượt quá 255 ký tự' })
  notes?: string;
}
