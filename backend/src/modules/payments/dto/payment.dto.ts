import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
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

export class CreateVnPayUrlDto {
  @Transform(trimLower) @IsUUID()
  orderId!: string;
}

export class VnPayQueryDto {
  @IsOptional() @IsString() vnp_Amount?: string;
  @IsOptional() @IsString() vnp_BankCode?: string;
  @IsOptional() @IsString() vnp_BankTranNo?: string;
  @IsOptional() @IsString() vnp_CardType?: string;
  @IsOptional() @IsString() vnp_OrderInfo?: string;
  @IsOptional() @IsString() vnp_PayDate?: string;
  @IsOptional() @IsString() vnp_ResponseCode?: string;
  @IsOptional() @IsString() vnp_TmnCode?: string;
  @IsOptional() @IsString() vnp_TransactionNo?: string;
  @IsOptional() @IsString() vnp_TransactionStatus?: string;
  @IsOptional() @IsString() vnp_TxnRef?: string;
  @IsOptional() @IsString() vnp_SecureHash?: string;
  @IsOptional() @IsString() vnp_SecureHashType?: string;
}

export class VnPayActionDto {
  @IsOptional() @IsString() paymentId?: string;
  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsString() orderCode?: string;
  @IsOptional() @IsString() transactionNo?: string;
}
