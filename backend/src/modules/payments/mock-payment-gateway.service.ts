// Owner: TV5 — #10. Replace stubs here; keep public DTO/port contracts.
import { Injectable } from '@nestjs/common';
import { MockPaymentGatewayPort } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { ApiError } from '../../common/errors/api-error';

const MAX_ORDER_TOTAL_VND = 2_000_000_000;

@Injectable()
export class MockPaymentGatewayService implements MockPaymentGatewayPort {
  async charge(input: {
    orderId: string;
    amount: number;
    method: Api.PaymentMethod;
    mockOutcome: 'SUCCESS' | 'FAIL';
  }): Promise<{ status: 'SUCCEEDED' | 'FAILED' }> {
    if (!Number.isInteger(input.amount) || input.amount < 0 || input.amount > MAX_ORDER_TOTAL_VND) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Số tiền thanh toán không hợp lệ', [
        { field: 'amount', message: 'Số tiền phải là số nguyên VND từ 0 đến 2.000.000.000' },
      ]);
    }
    if (input.method !== 'WALLET' && input.method !== 'CARD') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Phương thức thanh toán không hợp lệ', [
        { field: 'method', message: 'Phương thức thanh toán phải là WALLET hoặc CARD' },
      ]);
    }
    if (input.mockOutcome === 'FAIL') {
      return { status: 'FAILED' };
    }
    return { status: 'SUCCEEDED' };
  }
}
