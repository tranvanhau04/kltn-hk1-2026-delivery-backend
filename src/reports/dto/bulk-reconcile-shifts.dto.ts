import { IsArray, IsUUID, ArrayNotEmpty } from 'class-validator';

export class BulkReconcileShiftsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  shiftIds: string[];
}
