import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength, ValidateBy } from 'class-validator';
import { trimLower } from '../../../common/dto/shared.dto';
import type { AuthRequest, LoginRequest } from '../../../common/contracts/api.generated';

const maxPasswordBytes = () => ValidateBy({ name: 'maxPasswordBytes', validator: {
  validate: (value: unknown) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72,
  defaultMessage: () => 'password không được vượt quá 72 byte UTF-8',
} });

export class RegisterDto implements AuthRequest {
  @Transform(trimLower) @IsEmail() @MaxLength(254)
  email!: string;
  @IsString() @MinLength(8) @MaxLength(72) @maxPasswordBytes()
  password!: string;
}
export class LoginDto implements LoginRequest {
  @Transform(trimLower) @IsEmail() @MaxLength(254)
  email!: string;
  @IsString() @MinLength(1) @MaxLength(72) @maxPasswordBytes()
  password!: string;
}
