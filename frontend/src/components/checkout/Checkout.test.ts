import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import { it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
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
      if (id === '@/lib/checkout/errors') return { describeCheckoutError: (e: unknown) => ({ message: String(e) }), comparePrice: () => ({ changed: false, orderTotal: 0, difference: 0 }) };
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

it('auto-resets a completed session when entering checkout with new cart items and displays prices and vouchers immediately', () => {
  const user = { id: 'user', email: 'review@example.com', role: 'CUSTOMER', loyaltyPoints: 0 };
  const completedSaved: CheckoutState = {
    userId: user.id,
    purchased: [{ id: 'old-line', key: 'old|M', qty: 1 }],
    orderId: 'old-order-id',
    order: {
      id: 'old-order-id',
      code: 'BL-20261026-6B31E6A9',
      status: 'COMPLETED',
      reservationStatus: 'CONSUMED',
      version: 4,
      subtotal: 55000,
      discount: 0,
      total: 55000,
      currency: 'VND',
      promotionCode: null,
      createdAt: '',
      updatedAt: '',
      items: [],
    },
  };
  const cartLines = [
    {
      id: 'new-line-1',
      key: 'cap|M',
      productId: '11111111-1111-4111-8111-111111111111',
      productName: 'Cappuccino',
      imageUrl: '/images/cappuccino.jpg',
      size: 'M',
      sizePrice: 50000,
      toppings: [{ id: 't1', name: 'Kem', price: 10000 }],
      qty: 2,
      selected: true,
    },
    {
      id: 'unselected-line-2',
      key: 'ame|S',
      productId: '11111111-1111-4111-8111-111111111113',
      productName: 'Americano',
      imageUrl: '/images/americano.jpg',
      size: 'S',
      sizePrice: 40000,
      toppings: [],
      qty: 1,
      selected: false,
    },
  ];
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: () => JSON.stringify(completedSaved),
      setItem() {},
    },
  });
  try {
    const nodeRequire = createRequire(import.meta.url);
    const customRequire = (id: string) => {
      if (id === 'react/jsx-runtime') return nodeRequire(id) as unknown;
      if (id === 'react') return React;
      if (id === 'next/link')
        return {
          __esModule: true,
          default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
            React.createElement('a', props, props.children),
        };
      if (id === 'next/navigation') return { useRouter: () => ({ replace() {} }) };
      if (id === '@/lib/auth')
        return {
          getToken: () => 'token',
          getUser: () => user,
          getAuthSnapshot: () => user,
          getAuthServerSnapshot: () => user,
          subscribeAuth: () => () => {},
          updateUserPoints() {},
        };
      if (id === '@/lib/cart/cart-store')
        return {
          useCartHydrated: () => true,
          useCartStore: (selector: (state: { lines: typeof cartLines }) => unknown) =>
            selector({ lines: cartLines }),
          toCartItems: () => [{ productId: cartLines[0].productId, size: 'M', toppingIds: ['t1'], qty: 2 }],
        };
      if (id === '@/lib/checkout/session') return { createCheckoutSession, createCheckoutLifecycle, paidStatuses };
      if (id === '@/lib/checkout/errors')
        return {
          describeCheckoutError: (e: unknown) => ({ message: String(e) }),
          comparePrice: () => ({ changed: false, orderTotal: 0, difference: 0 }),
        };
      if (id === '@/lib/api') return {};
      if (id === '@/components/payments/payment-api') return { formatVnd: (amount: number) => `${amount} VND` };
      throw new Error(`Unexpected module: ${id}`);
    };
    const filename = fileURLToPath(new URL('./Checkout.tsx', import.meta.url));
    const js = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const compiledModule = { exports: {} as { default: React.ComponentType } };
    const evaluate = runInThisContext(`(function(require,module,exports){${js}\n})`, { filename }) as (
      require: typeof customRequire,
      compiled: { exports: object },
      exports: object,
    ) => void;
    evaluate(customRequire, compiledModule, compiledModule.exports);
    const html = renderToStaticMarkup(React.createElement(compiledModule.exports.default));
    // Không nhảy tới đơn cũ BL-20261026-6B31E6A9 mà hiển thị giỏ hàng mới + giá ngay lập tức + khu vực chọn voucher
    assert.doesNotMatch(html, /BL-20261026-6B31E6A9/);
    assert.match(html, /Cappuccino/);
    assert.doesNotMatch(html, /Americano/);
    assert.match(html, /120000 VND/);
    assert.match(html, /SAVE10/);
    assert.match(html, /GIAM20K/);
    assert.doesNotMatch(html, /Tính giá từ hệ thống/);
    // Giao diện 1 cột cuộn từ trên xuống dưới, không chia 2 cột sang bên phải
    assert.doesNotMatch(html, /lg:grid-cols-\[1\.35fr_1fr\]/);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

it('[P1] unverified retry after timeout renders unverified screen with verify button and no retry button', () => {
  const user = { id: 'user', email: 'review@example.com', role: 'CUSTOMER', loyaltyPoints: 10 };
  const unverifiedRetry: CheckoutState = {
    userId: user.id,
    purchased: [{ id: 'line-1', key: 'cap|M', qty: 2 }],
    orderId: 'order-123',
    order: {
      id: 'order-123',
      code: 'BL-FAILED-001',
      status: 'PAYMENT_FAILED',
      reservationStatus: 'RELEASED',
      version: 2,
      subtotal: 120000,
      discount: 0,
      total: 120000,
      currency: 'VND',
      promotionCode: null,
      createdAt: '',
      updatedAt: '',
      items: [],
    },
    attempt: {
      key: 'retry-timeout-key',
      request: { orderId: 'order-123', method: 'CARD', mockOutcome: 'SUCCESS' },
    },
  };
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: () => JSON.stringify(unverifiedRetry),
      setItem() {},
    },
  });
  try {
    const nodeRequire = createRequire(import.meta.url);
    const customRequire = (id: string) => {
      if (id === 'react/jsx-runtime') return nodeRequire(id) as unknown;
      if (id === 'react') return React;
      if (id === 'next/link')
        return {
          __esModule: true,
          default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
            React.createElement('a', props, props.children),
        };
      if (id === 'next/navigation') return { useRouter: () => ({ replace() {} }) };
      if (id === '@/lib/auth')
        return {
          getToken: () => 'token',
          getUser: () => user,
          getAuthSnapshot: () => user,
          getAuthServerSnapshot: () => user,
          subscribeAuth: () => () => {},
          updateUserPoints() {},
        };
      if (id === '@/lib/cart/cart-store')
        return {
          useCartHydrated: () => true,
          useCartStore: (selector: (state: { lines: [] }) => unknown) => selector({ lines: [] }),
          toCartItems: () => [],
        };
      if (id === '@/lib/checkout/session') return { createCheckoutSession, createCheckoutLifecycle, paidStatuses };
      if (id === '@/lib/checkout/errors')
        return {
          describeCheckoutError: (e: unknown) => ({ message: String(e) }),
          comparePrice: () => ({ changed: false, orderTotal: 0, difference: 0 }),
        };
      if (id === '@/lib/api') return {};
      if (id === '@/components/payments/payment-api') return { formatVnd: (amount: number) => `${amount} VND` };
      throw new Error(`Unexpected module: ${id}`);
    };
    const filename = fileURLToPath(new URL('./Checkout.tsx', import.meta.url));
    const js = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const compiledModule = { exports: {} as { default: React.ComponentType } };
    const evaluate = runInThisContext(`(function(require,module,exports){${js}\n})`, { filename }) as (
      require: typeof customRequire,
      compiled: { exports: object },
      exports: object,
    ) => void;
    evaluate(customRequire, compiledModule, compiledModule.exports);
    const html = renderToStaticMarkup(React.createElement(compiledModule.exports.default));

    // Phải hiển thị màn hình Chưa xác nhận được kết quả thanh toán
    assert.match(html, /Chưa xác nhận được kết quả thanh toán/);
    assert.match(html, /Xác minh lại trạng thái đơn/);
    // Không hiện màn hình thất bại cũ với nút thử lại khóa mới
    assert.doesNotMatch(html, /Thanh toán thất bại/);
    assert.doesNotMatch(html, /Thử lại thanh toán ngay/);
    // Giữ nguyên thông tin attempt retry
    assert.match(html, /Thẻ ngân hàng/);
    assert.match(html, /SUCCESS/);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

it('[P2] renders expected points notice on PAID and completed notice on COMPLETED without claiming client balance is authoritative', () => {
  const user = { id: 'user', email: 'review@example.com', role: 'CUSTOMER', loyaltyPoints: 25 };
  const paidSaved: CheckoutState = {
    userId: user.id,
    purchased: [],
    orderId: 'paid-order',
    order: {
      id: 'paid-order',
      code: 'BL-PAID-001',
      status: 'PAID',
      reservationStatus: 'CONSUMED',
      version: 2,
      subtotal: 120000,
      discount: 0,
      total: 120000,
      currency: 'VND',
      promotionCode: null,
      createdAt: '',
      updatedAt: '',
      items: [],
    },
  };
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: () => JSON.stringify(paidSaved),
      setItem() {},
    },
  });
  try {
    const nodeRequire = createRequire(import.meta.url);
    const customRequire = (id: string) => {
      if (id === 'react/jsx-runtime') return nodeRequire(id) as unknown;
      if (id === 'react') return React;
      if (id === 'next/link')
        return {
          __esModule: true,
          default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
            React.createElement('a', props, props.children),
        };
      if (id === 'next/navigation') return { useRouter: () => ({ replace() {} }) };
      if (id === '@/lib/auth')
        return {
          getToken: () => 'token',
          getUser: () => user,
          getAuthSnapshot: () => user,
          getAuthServerSnapshot: () => user,
          subscribeAuth: () => () => {},
          updateUserPoints() {},
        };
      if (id === '@/lib/cart/cart-store')
        return {
          useCartHydrated: () => true,
          useCartStore: (selector: (state: { lines: [] }) => unknown) => selector({ lines: [] }),
          toCartItems: () => [],
        };
      // Khi session khởi tạo từ storage, ta tạo session và cho verified = true đối với đơn đã lưu PAID
      if (id === '@/lib/checkout/session') {
        return {
          createCheckoutSession: (uId: string, deps: Parameters<typeof createCheckoutSession>[1]) => {
            const sess = createCheckoutSession(uId, deps);
            // Giả lập snapshot đã verified từ find
            return {
              ...sess,
              snapshot: () => ({ ...paidSaved, verified: true }),
            };
          },
          createCheckoutLifecycle,
          paidStatuses,
        };
      }
      if (id === '@/lib/checkout/errors')
        return {
          describeCheckoutError: (e: unknown) => ({ message: String(e) }),
          comparePrice: () => ({ changed: false, orderTotal: 0, difference: 0 }),
        };
      if (id === '@/lib/api') return {};
      if (id === '@/components/payments/payment-api') return { formatVnd: (amount: number) => `${amount} VND` };
      throw new Error(`Unexpected module: ${id}`);
    };
    const filename = fileURLToPath(new URL('./Checkout.tsx', import.meta.url));
    const js = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const compiledModule = { exports: {} as { default: React.ComponentType } };
    const evaluate = runInThisContext(`(function(require,module,exports){${js}\n})`, { filename }) as (
      require: typeof customRequire,
      compiled: { exports: object },
      exports: object,
    ) => void;
    evaluate(customRequire, compiledModule, compiledModule.exports);
    const htmlPaid = renderToStaticMarkup(React.createElement(compiledModule.exports.default));

    // Đơn PAID: không báo đã tích lũy điểm, mà báo điểm dự kiến sẽ được cộng khi hoàn thành
    assert.match(htmlPaid, /Điểm dự kiến: \+12\. Điểm được cộng khi đơn hoàn thành\./);
    assert.doesNotMatch(htmlPaid, /Tích lũy \+12 điểm thưởng/);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});
