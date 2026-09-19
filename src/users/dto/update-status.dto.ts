import { IsEnum, IsNotEmpty } from 'class-validator';
import { UserStatus } from '../../entities/user.entity';

export class UpdateStatusDto {
  @IsNotEmpty({ message: 'Status is required' })
  @IsEnum(UserStatus, {
    message: `Status must be one of: ${Object.values(UserStatus).join(', ')}`,
  })
  status: UserStatus;
}
