import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateUserDto {
  @IsOptional()
  @IsString({ message: 'Full name must be a string' })
  @MaxLength(100, { message: 'Full name must not exceed 100 characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  fullName?: string;

  @IsOptional()
  @IsString({ message: 'Phone number must be a string' })
  @Matches(/^(0|\+84)[3|5|7|8|9][0-9]{8}$/, {
    message:
      'Phone must be a valid Vietnamese mobile number (10 digits starting with 03, 05, 07, 08, 09)',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  phone?: string;
}
