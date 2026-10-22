import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested, ValidationError } from 'class-validator';
import { Type } from 'class-transformer';
import type { CartItem, Size } from '../contracts/api.generated';

export const trimLower = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value;
export const trimUpper = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toUpperCase() : value;
const decimalInteger = ({ value }: { value: unknown }) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
export const ifDefined = (_object: unknown, value: unknown) => value !== undefined;

export class EmptyQueryDto {}

export class PaginationDto {
  @Transform(decimalInteger) @IsInt() @Min(1)
  page = 1;

  @Transform(decimalInteger) @IsInt() @Min(1) @Max(50)
  limit = 12;
}

export class IdParamDto {
  @Transform(trimLower) @IsUUID()
  id!: string;
}

export class CartItemDto implements CartItem {
  @Transform(trimLower) @IsUUID()
  productId!: string;

  @IsIn(['S', 'M', 'L'])
  size!: Size;

  @ValidateIf(ifDefined) @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsUUID('all', { each: true })
  @Transform(({ value }: { value: unknown }) => Array.isArray(value) ? value.map(x => typeof x === 'string' ? x.toLowerCase() : x) : value)
  toppingIds?: string[];

  @IsInt() @Min(1) @Max(99)
  qty!: number;
}

export class CartRequestDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => CartItemDto)
  items!: CartItemDto[];
}

export class PromotionCodeDto {
  @Transform(trimUpper) @IsString() @MinLength(3) @MaxLength(32) @Matches(/^[A-Z0-9_-]+$/)
  code!: string;
}

export function validationDetails(errors: ValidationError[], prefix = ''): Array<{ field: string; message: string }> {
  return errors.flatMap(error => {
    const field = prefix ? `${prefix}.${error.property}` : error.property;
    return [
      ...Object.values(error.constraints ?? {}).map(message => ({ field, message })),
      ...validationDetails(error.children ?? [], field),
    ];
  });
}
