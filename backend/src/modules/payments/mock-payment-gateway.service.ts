// Owner: TV5 — #10. Replace stubs here; keep public DTO/port contracts.
import { Injectable } from '@nestjs/common';
import { MockPaymentGatewayPort } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { notImplemented } from '../../common/errors/api-error';

@Injectable()
export class MockPaymentGatewayService implements MockPaymentGatewayPort {
  charge(_input: { orderId: string; amount: number; method: Api.PaymentMethod; mockOutcome: 'SUCCESS' | 'FAIL' }): Promise<{ status: 'SUCCEEDED' | 'FAILED' }> {
    return notImplemented('payments.charge');
  }
}
