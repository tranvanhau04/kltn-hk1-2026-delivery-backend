import { IsEnum, IsNotEmpty } from 'class-validator';
import { UserRole } from '../../entities/user.entity';

export class UpdateRoleDto {
  @IsNotEmpty({ message: 'Role is required' })
  @IsEnum(UserRole, {
    message: `Role must be one of: ${Object.values(UserRole).join(', ')}`,
  })
  role: UserRole;
}
