import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, Matches, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { CartRequestDto, ifDefined, trimUpper } from '../../../common/dto/shared.dto';
import type { CancelRequest, OrderRequest, StatusRequest } from '../../../common/contracts/api.generated';

export class CreateOrderDto extends CartRequestDto implements OrderRequest {
  @ValidateIf(ifDefined) @Transform(trimUpper) @IsString() @MinLength(3) @MaxLength(32) @Matches(/^[A-Z0-9_-]+$/)
  promotionCode?: string;
}
export class CancelOrderDto implements CancelRequest {
  @IsInt() @Min(0)
  expectedVersion!: number;
}
export class TransitionOrderDto extends CancelOrderDto implements StatusRequest {
  @IsIn(['PREPARING', 'READY', 'COMPLETED'])
  status!: StatusRequest['status'];
}
