import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ReconcileShiftDto {
  @IsNumber()
  @Min(0)
  submittedAmount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
