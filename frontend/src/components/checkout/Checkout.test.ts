import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import { it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
// @ts-expect-error TS5097: Node native TypeScript test resolution
import { createCheckoutSession, createCheckoutLifecycle, paidStatuses } from '../../lib/checkout/session.ts';
import type { CheckoutState } from '../../lib/checkout/session';

it('restores CARD/FAIL controls from the saved attempt instead of displaying WALLET/SUCCESS', () => {
  const user = { id: 'user', email: 'review@example.com', role: 'CUSTOMER', loyaltyPoints: 0 };
  const saved: CheckoutState = { userId: user.id, purchased: [], orderId: 'order',
    order: { id: 'order', code: 'BL-ORDER', status: 'PENDING', reservationStatus: 'HELD', version: 0,
      subtotal: 120000, discount: 0, total: 120000, currency: 'VND', promotionCode: null, createdAt: '', updatedAt: '', items: [] },
    attempt: { key: 'same-payment-key', request: { orderId: 'order', method: 'CARD', mockOutcome: 'FAIL' } } };
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: () => JSON.stringify(saved), setItem() {},
  } });
  try {
    const nodeRequire = createRequire(import.meta.url);
    const customRequire = (id: string) => {
      if (id === 'react/jsx-runtime') return nodeRequire(id) as unknown;
      if (id === 'react') return React;
      if (id === 'next/link') return { __esModule: true, default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement('a', props, props.children) };
      if (id === 'next/navigation') return { useRouter: () => ({ replace() {} }) };
      if (id === '@/lib/auth') return { getToken: () => 'token', getUser: () => user,
        getAuthSnapshot: () => user, getAuthServerSnapshot: () => user, subscribeAuth: () => () => {}, updateUserPoints() {} };
      if (id === '@/lib/cart/cart-store') return { useCartHydrated: () => true,
        useCartStore: (selector: (state: { lines: [] }) => unknown) => selector({ lines: [] }), toCartItems: () => [] };
      if (id === '@/lib/checkout/session') return { createCheckoutSession, createCheckoutLifecycle, paidStatuses };
      if (id === '@/lib/api') return {};
      if (id === '@/components/payments/payment-api') return { formatVnd: (amount: number) => `${amount} VND` };
      throw new Error(`Unexpected module: ${id}`);
    };
    const filename = fileURLToPath(new URL('./Checkout.tsx', import.meta.url));
    const js = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const compiledModule = { exports: {} as { default: React.ComponentType } };
    const evaluate = runInThisContext(`(function(require,module,exports){${js}\n})`, { filename }) as
      (require: typeof customRequire, compiled: { exports: object }, exports: object) => void;
    evaluate(customRequire, compiledModule, compiledModule.exports);
    const html = renderToStaticMarkup(React.createElement(compiledModule.exports.default));
    assert.match(html, /<select disabled=""><option value="WALLET">.*?<option value="CARD" selected="">/);
    assert.match(html, /<select disabled=""><option value="SUCCESS">.*?<option value="FAIL" selected="">/);
    assert.deepEqual(saved.attempt?.request, { orderId: 'order', method: 'CARD', mockOutcome: 'FAIL' });
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});
