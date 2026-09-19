import { IsEnum, IsNotEmpty } from 'class-validator';
import { DriverShiftStatus } from '../../entities/driver.entity';

export class UpdateShiftStatusDto {
  @IsNotEmpty({ message: 'Shift status is required' })
  @IsEnum(DriverShiftStatus, {
    message: `Shift status must be one of: ${Object.values(DriverShiftStatus).join(', ')}`,
  })
  currentShiftStatus: DriverShiftStatus;
}
