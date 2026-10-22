import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { CartRequestDto, trimUpper } from '../../../common/dto/shared.dto';
import type { PromotionValidationRequest } from '../../../common/contracts/api.generated';

export class ValidatePromotionDto extends CartRequestDto implements PromotionValidationRequest {
  @Transform(trimUpper) @IsString() @MinLength(3) @MaxLength(32) @Matches(/^[A-Z0-9_-]+$/)
  code!: string;
}
