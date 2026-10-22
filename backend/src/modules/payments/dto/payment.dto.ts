import { Transform } from 'class-transformer';
import { IsIn, IsUUID, ValidateIf } from 'class-validator';
import { ifDefined, trimLower } from '../../../common/dto/shared.dto';
import type { PaymentMethod, PaymentRequest } from '../../../common/contracts/api.generated';

export class CreatePaymentDto implements PaymentRequest {
  @Transform(trimLower) @IsUUID()
  orderId!: string;
  @IsIn(['WALLET', 'CARD'])
  method!: PaymentMethod;
  @ValidateIf(ifDefined) @IsIn(['SUCCESS', 'FAIL'])
  mockOutcome?: 'SUCCESS' | 'FAIL';
}
