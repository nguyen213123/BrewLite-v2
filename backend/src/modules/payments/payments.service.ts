// Owner: TV5 — #10. Replace stubs here; keep public DTO/port contracts.
import { Injectable } from '@nestjs/common';
import { PaymentsPort } from '../../common/contracts/ports';
import type { IdempotentResult } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { notImplemented } from '../../common/errors/api-error';

@Injectable()
export class PaymentsService implements PaymentsPort {
  pay(_userId: string, _key: string, _input: Api.PaymentRequest): Promise<IdempotentResult<Api.PaymentResult>> {
    return notImplemented('payments.pay');
  }
}
