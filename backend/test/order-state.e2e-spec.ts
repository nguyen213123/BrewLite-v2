import { assertTransition } from '../src/modules/orders/domain/order-state-machine';
import type { OrderStatus } from '../src/common/contracts/api.generated';

const states: OrderStatus[] = ['PENDING', 'PAID', 'PREPARING', 'READY', 'COMPLETED', 'PAYMENT_FAILED', 'CANCELLED'];
const allowed = new Set(['PENDING:PAID', 'PENDING:PAYMENT_FAILED', 'PENDING:CANCELLED', 'PAYMENT_FAILED:PENDING', 'PAYMENT_FAILED:CANCELLED', 'PAID:PREPARING', 'PAID:CANCELLED', 'PREPARING:READY', 'READY:COMPLETED']);
describe('State transition table from the BrewLite specification', () => {
  for (const from of states) for (const to of states) {
    it(`${from} → ${to}: ${allowed.has(`${from}:${to}`) ? 'allowed' : 'rejected'}`, () => {
      if (allowed.has(`${from}:${to}`)) expect(() => assertTransition(from, to)).not.toThrow();
      else expect(() => assertTransition(from, to)).toThrow();
    });
  }
});
