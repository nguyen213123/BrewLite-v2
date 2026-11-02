import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');

function evaluate(source: string, mocks: Record<string, unknown>): Record<string, () => unknown> {
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(js, {
    exports, require: (name: string) => {
      if (name in mocks) return mocks[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}

for (const gateway of ['vnpay', 'stripe']) {
  for (const scenario of ['network-error', 'foreign-session', 'matching-session', 'manual-refund']) {
    test(`${gateway} return preserves unrelated cart data (${scenario})`, async () => {
      const helper = evaluate(readFileSync(new URL('./vnpay-return.ts', import.meta.url), 'utf8'), {});
      let effect = () => {};
      let cleared = 0;
      let settled = 0;
      const stored = JSON.stringify({ userId: 'user-1', orderId: scenario === 'matching-session' ? 'order-1' : 'other-order', purchased: [{ id: 'line-1', qty: 1 }] });
      // The actual helper reads browser storage through the page's dependency callbacks.
      const moduleSource = readFileSync(new URL(`../../app/payments/${gateway}-return/page.tsx`, import.meta.url), 'utf8');
      const component = gateway === 'stripe' ? 'StripeReturnContent' : 'VnPayReturnContent';
      const mocks: Record<string, unknown> = {
        'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
        react: { useState: (value: unknown) => [value, () => {}], useEffect: (fn: () => void) => { effect = fn; } },
        'next/link': {}, 'next/navigation': { useSearchParams: () => new URLSearchParams('session_id=cs_test') },
        '@/lib/api': { apiGet: async (path: string) => {
          if (path.startsWith('/orders/')) {
            if (scenario === 'network-error') throw new Error('offline');
            return { id: 'order-1', status: 'PAID' };
          }
          return { success: scenario !== 'manual-refund', orderId: 'order-1', orderCode: 'BL-1', paymentReceived: scenario === 'manual-refund' };
        } },
        '@/lib/auth': { getUser: () => ({ id: 'user-1' }) },
        '@/lib/cart/cart-store': { useCartStore: { getState: () => ({ clear: () => cleared++, settleOrder: () => settled++ }) } },
        '@/lib/checkout/vnpay-return': helper,
        '@/components/payments/payment-api': { formatVnd: String },
      };
      const exports = {};
      const js = ts.transpileModule(moduleSource.replace(`function ${component}()`, `export function ${component}()`), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
      }).outputText;
      vm.runInNewContext(js, { exports, window: { sessionStorage: { getItem: () => stored, setItem: () => {} } },
        require: (name: string) => { if (name in mocks) return mocks[name]; throw new Error(name); },
      });
      (exports as Record<string, () => unknown>)[component]();
      effect();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(cleared, 0);
      assert.equal(settled, scenario === 'matching-session' ? 1 : 0);
    });
  }
}
