import { IsArray, IsString, ArrayNotEmpty } from 'class-validator';

export class AssignDriversDto {
  @IsArray({ message: 'driverIds phải là mảng.' })
  @ArrayNotEmpty({ message: 'Danh sách tài xế không được rỗng.' })
  @IsString({ each: true, message: 'Mỗi driverId phải là chuỗi.' })
  driverIds: string[];
}
