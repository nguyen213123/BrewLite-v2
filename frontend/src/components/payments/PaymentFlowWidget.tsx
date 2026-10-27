'use client';

/**
 * Owner: TV5 — #10. Single-page Cashless Payment & Result Web UI + Reusable Checkout Callbacks.
 *
 * Integration Contract for Team Handoff (TV2 Checkout / TV4 Order History):
 * - Compliant with OpenAPI (`docs/api/openapi.yaml`) and generated types (`src/lib/contracts/api.generated.ts`).
 * - Demo fixtures (`DEMO_*`, `AVAILABLE_PROMOTIONS`) are strictly isolated to `isDemo === true`
 *   (used only on `/payments` standalone showcase when `onExecutePayment` is omitted).
 * - In integration mode (`isDemo === false` or whenever `onExecutePayment` is provided):
 *   1. Inputs:
 *      - `order`: Order snapshot from `POST /api/orders` (`id`, `code`, `subtotal`, `discount`, `total`, `promotionCode`, `items`, `status`, `reservationStatus`).
 *      - `onExecutePayment`: Calls `submitPayment()` from `./payment-api` (`POST /api/payments` with `Idempotency-Key` header; automatically calls `GET /api/orders/{id}` when `Idempotency-Replayed: true`).
 *      - `onVerifyOrder`: Calls `fetchCurrentOrder(orderId, accessToken)` from `./payment-api` (`GET /api/orders/{id}` without re-posting payment).
 *   2. Callbacks:
 *      - `onPaymentCommitted`: Emitted ONLY after payment outcome is verified (`verified === true`).
 *        TV2's cart store must only clear purchased cart items when `payload.verified === true && payload.status === 'PAID'`.
 *      - `onNotify`: Optional toast/banner message handler.
 */
import Link from 'next/link';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type * as Api from '../../lib/contracts/api.generated';
import {
  calculateExpectedLoyaltyPoints,
  createPaymentIdempotencyKey,
  formatVnd,
  type PaymentExecutionOutcome,
} from './payment-api';
import './payments.css';

export type IconName =
  | 'coffee'
  | 'arrow'
  | 'check'
  | 'wallet'
  | 'card'
  | 'lock'
  | 'chevron'
  | 'flask'
  | 'refresh'
  | 'copy'
  | 'shield'
  | 'info'
  | 'close'
  | 'star'
  | 'grid'
  | 'layers'
  | 'external';

export type PromotionOption = {
  code: string;
  label: string;
  conditionText: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  minSubtotal: number;
  maxDiscount?: number;
  expired?: boolean;
};

/**
 * Demo-only promotion presets for standalone showcase.
 * In real checkout integration, discount & promotionCode come from the backend Order/Quote snapshot.
 */
export const AVAILABLE_PROMOTIONS: readonly PromotionOption[] = [
  {
    code: 'SAVE10',
    label: 'Giảm 10% đơn hàng',
    conditionText: 'Đơn từ 50.000 ₫ · Giảm 12.000 ₫',
    type: 'PERCENT',
    value: 10,
    minSubtotal: 50_000,
    maxDiscount: 30_000,
  },
  {
    code: 'BREW20K',
    label: 'Giảm trực tiếp 20.000 ₫',
    conditionText: 'Đơn từ 100.000 ₫ · Áp dụng mọi món',
    type: 'FIXED',
    value: 20_000,
    minSubtotal: 100_000,
  },
  {
    code: 'FREETOPPING',
    label: 'Tặng 10.000 ₫ phí Topping',
    conditionText: 'Không yêu cầu đơn tối thiểu',
    type: 'FIXED',
    value: 10_000,
    minSubtotal: 0,
  },
  {
    code: 'VIP30',
    label: 'Giảm 30% khách VIP',
    conditionText: 'Đơn tối thiểu 200.000 ₫ (Chưa đủ ĐK)',
    type: 'PERCENT',
    value: 30,
    minSubtotal: 200_000,
    maxDiscount: 50_000,
  },
];

const DEFAULT_ORDER_CODE = 'BL-20261022-A1B2C3D4';
const DEFAULT_IDEMPOTENCY_KEY = '77777777-7777-4777-8777-777777777777';
const DEMO_SUBTOTAL = 120_000;
const DEMO_PROMO_CODE = 'SAVE10';

/**
 * Order statuses that represent a successfully paid order (including post-payment fulfillment states).
 * Per business-rules.md section 4 & 7.9: PREPARING, READY, COMPLETED must never be treated as
 * PAYMENT_FAILED or allow retry payment.
 */
export const FULFILLMENT_POSITIVE_ORDER_STATUSES: ReadonlySet<Api.OrderStatus> = new Set([
  'PAID',
  'PREPARING',
  'READY',
  'COMPLETED',
]);

export function isOrderPaidOrFulfilling(
  orderStatus?: Api.OrderStatus | null,
  paymentStatus?: Api.Payment['status'] | null,
): boolean {
  if (orderStatus && FULFILLMENT_POSITIVE_ORDER_STATUSES.has(orderStatus)) {
    return true;
  }
  if (!orderStatus && paymentStatus === 'SUCCEEDED') {
    return true;
  }
  return false;
}

export function isOrderPayableForRetry(orderStatus?: Api.OrderStatus | null): boolean {
  return !orderStatus || orderStatus === 'PAYMENT_FAILED' || orderStatus === 'PENDING';
}

export function resolveReservationStatus(
  orderStatus?: Api.OrderStatus | null,
  reservationStatus?: Api.Order['reservationStatus'] | null,
): Api.Order['reservationStatus'] {
  if (reservationStatus) {
    return reservationStatus;
  }
  if (orderStatus && FULFILLMENT_POSITIVE_ORDER_STATUSES.has(orderStatus)) {
    return 'CONSUMED';
  }
  if (orderStatus === 'PAYMENT_FAILED' || orderStatus === 'CANCELLED') {
    return 'RELEASED';
  }
  return 'HELD';
}

export function computePromotionDiscount(subtotal: number, promo: PromotionOption | null): number {
  if (!promo || promo.expired || subtotal < promo.minSubtotal) {
    return 0;
  }
  if (promo.type === 'FIXED') {
    return Math.min(promo.value, subtotal);
  }
  const raw = Math.floor((subtotal * promo.value) / 100);
  const capped = promo.maxDiscount !== undefined ? Math.min(raw, promo.maxDiscount) : raw;
  return Math.min(capped, subtotal);
}

export function PaymentIcon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    coffee: <path d="M4 8h12v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 9h2a3 3 0 1 1 0 6h-2M7 3v2m4-2v2m4-2v2" />,
    arrow: <path d="m12 5-7 7 7 7M5 12h15" />,
    check: <path d="m5 12 4 4L19 6" />,
    wallet: (
      <>
        <path d="M20 7H5a2 2 0 0 1 0-4h13v4M4 5v14h16V7M20 11h-6v5h6" />
        <path d="M16 13.5h.01" />
      </>
    ),
    card: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M3 10h18M7 15h4" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
      </>
    ),
    chevron: <path d="m8 10 4 4 4-4" />,
    flask: <path d="M9 3h6m-5 0v7L4 20h16l-6-10V3M7 15h10" />,
    refresh: <path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-10v.01" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    star: <path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z" />,
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    layers: <path d="m12 3 10 5-10 5L2 8zm-10 9 10 5 10-5M2 16l10 5 10-5" />,
    external: <path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function PaymentButton({
  children,
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) {
  return (
    <button className={`btn ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function PaymentBadge({ children, tone = 'amber' }: { children: ReactNode; tone?: string }) {
  return (
    <span className={`badge ${tone}`}>
      <span />
      {children}
    </span>
  );
}

export function PaymentNotice({
  children,
  tone = 'indigo',
  icon = 'info',
}: {
  children: ReactNode;
  tone?: string;
  icon?: IconName;
}) {
  return (
    <div className={`notice ${tone}`}>
      <PaymentIcon name={icon} size={18} />
      <div>{children}</div>
    </div>
  );
}

export type CheckoutOrderItem = {
  name: string;
  quantity?: number;
  unitPrice: number;
  details?: string;
};

export type CheckoutOrderData = {
  id?: string;
  code?: string;
  status?: Api.OrderStatus;
  reservationStatus?: Api.Order['reservationStatus'];
  version?: number;
  items?: ReadonlyArray<CheckoutOrderItem | Api.OrderItem>;
  subtotal?: number;
  discount?: number;
  total?: number;
  promotionCode?: string | null;
};

const DEMO_DEFAULT_ITEMS: readonly CheckoutOrderItem[] = [
  {
    name: '2 × Cappuccino',
    quantity: 2,
    unitPrice: 120_000,
    details: 'Size M (50.000 ₫ / ly) · Topping: Kem (+10.000 ₫ / ly)',
  },
];

export function normalizeDisplayItems(
  items?: ReadonlyArray<CheckoutOrderItem | Api.OrderItem>,
  isDemo = false,
): CheckoutOrderItem[] {
  if (items && items.length > 0) {
    return items.map(item => {
      if ('productName' in item) {
        const toppingSummary =
          item.toppings && item.toppings.length > 0
            ? ` · Topping: ${item.toppings.map(t => `${t.name} (+${formatVnd(t.price)})`).join(', ')}`
            : '';
        return {
          name: `${item.qty} × ${item.productName}`,
          quantity: item.qty,
          unitPrice: item.lineTotal,
          details: `Size ${item.size} (${formatVnd(item.sizePrice)} / ly)${toppingSummary}`,
        };
      }
      return item;
    });
  }
  return isDemo ? [...DEMO_DEFAULT_ITEMS] : [];
}

export function PaymentOrderSummary({
  orderCode,
  items,
  isDemo = false,
  status = 'PENDING',
  reservationStatus,
  version = 0,
}: {
  orderCode?: string;
  items?: ReadonlyArray<CheckoutOrderItem | Api.OrderItem>;
  isDemo?: boolean;
  status?: Api.OrderStatus;
  reservationStatus?: Api.Order['reservationStatus'];
  version?: number;
}) {
  const resolvedOrderCode = orderCode || (isDemo ? DEFAULT_ORDER_CODE : '');
  const displayItems = normalizeDisplayItems(items, isDemo);
  const reservationLabel = resolveReservationStatus(status, reservationStatus);
  const badgeTone = isOrderPaidOrFulfilling(status)
    ? 'green'
    : status === 'PAYMENT_FAILED' || status === 'CANCELLED'
      ? 'rose'
      : 'amber';

  return (
    <section className="brewlite-card">
      <div className="brewlite-card-header">
        <h2 className="brewlite-card-title">Đơn hàng của bạn</h2>
        <PaymentBadge tone={badgeTone}>{status}</PaymentBadge>
      </div>
      <div className="order-meta-bar">
        <span>
          Mã đơn: <strong className="mono">#{resolvedOrderCode}</strong>
        </span>
        <span>
          {isDemo
            ? `Dữ liệu mô phỏng · Giữ kho: ${reservationLabel}`
            : `Giữ kho: ${reservationLabel} · Phiên bản: v${version}`}
        </span>
      </div>
      {displayItems.map((item, idx) => (
        <div className="order-item-row" key={idx}>
          <div className="cup-thumb">
            <PaymentIcon name="coffee" size={26} />
          </div>
          <div className="item-info">
            <strong>{item.name}</strong>
            {item.details && <span className="item-topping-tag">{item.details}</span>}
          </div>
          <strong className="mono item-price">{formatVnd(item.unitPrice)}</strong>
        </div>
      ))}
    </section>
  );
}

export function PaymentPromotionBox({
  subtotal = 0,
  selectedCode,
  onSelectCode,
}: {
  subtotal?: number;
  selectedCode: string | null;
  onSelectCode: (code: string | null) => void;
}) {
  const [inputCode, setInputCode] = useState(selectedCode ?? '');
  const [error, setError] = useState('');

  const activePromo = AVAILABLE_PROMOTIONS.find(p => p.code === selectedCode) ?? null;
  const activeDiscount = computePromotionDiscount(subtotal, activePromo);

  const tryApplyCode = (rawCode: string) => {
    const normalized = rawCode.trim().toUpperCase();
    setInputCode(normalized);

    if (!normalized) {
      onSelectCode(null);
      setError('Vui lòng nhập hoặc chọn một mã khuyến mãi.');
      return;
    }

    if (normalized === 'OLD10') {
      onSelectCode(null);
      setError('422 PROMOTION_INVALID: Mã OLD10 đã hết hạn sử dụng.');
      return;
    }

    const found = AVAILABLE_PROMOTIONS.find(p => p.code === normalized);
    if (!found) {
      onSelectCode(null);
      setError(`422 PROMOTION_INVALID: Mã "${normalized}" không tồn tại. Hãy chọn mã bên dưới.`);
      return;
    }

    if (subtotal < found.minSubtotal) {
      onSelectCode(null);
      setError(
        `422 PROMOTION_INVALID: Mã ${found.code} yêu cầu đơn tối thiểu ${formatVnd(found.minSubtotal)} (hiện tại ${formatVnd(subtotal)}).`,
      );
      return;
    }

    onSelectCode(found.code);
    setError('');
  };

  return (
    <section className="brewlite-card">
      <div className="brewlite-card-header">
        <h2 className="brewlite-card-title">Mã khuyến mãi</h2>
        <span className="brewlite-card-subtitle">Nhập mã hoặc chọn voucher có sẵn</span>
      </div>

      <form
        className="promotion-row"
        onSubmit={e => {
          e.preventDefault();
          tryApplyCode(inputCode);
        }}
      >
        <input
          id="promotion-code"
          className="mono"
          value={inputCode}
          onChange={e => {
            setInputCode(e.target.value.toUpperCase());
            setError('');
          }}
          placeholder="Nhập mã ưu đãi (VD: SAVE10, BREW20K...)"
        />
        <PaymentButton
          variant={activePromo && activePromo.code === inputCode.trim() ? 'applied' : 'primary'}
          className="compact"
          type="submit"
        >
          {activePromo && activePromo.code === inputCode.trim() && (
            <PaymentIcon name="check" size={14} />
          )}
          {activePromo && activePromo.code === inputCode.trim() ? 'Đã áp dụng' : 'Áp dụng'}
        </PaymentButton>
      </form>

      {activePromo && (
        <div className="promotion-chip">
          <PaymentIcon name="check" size={15} />
          <span>
            <strong>{activePromo.code}:</strong> {activePromo.label} (−{formatVnd(activeDiscount)})
          </span>
          <button
            type="button"
            onClick={() => {
              onSelectCode(null);
              setInputCode('');
              setError('');
            }}
            aria-label={`Gỡ mã ${activePromo.code}`}
          >
            <PaymentIcon name="close" size={15} />
          </button>
        </div>
      )}

      <p className={error ? 'promotion-error' : 'promotion-helper'} role={error ? 'alert' : undefined}>
        {error || 'Bạn có thể tự nhập mã vào ô trên hoặc bấm chọn nhanh các mã ưu đãi bên dưới.'}
      </p>

      <div className="voucher-picker">
        <div className="voucher-picker-label">
          <span>Chọn nhanh mã ưu đãi có sẵn</span>
          <span>Chỉ áp dụng 1 mã / đơn</span>
        </div>
        <div className="voucher-list">
          {AVAILABLE_PROMOTIONS.map(v => {
            const isSelected = selectedCode === v.code;
            const isEligible = subtotal >= v.minSubtotal && !v.expired;
            return (
              <button
                type="button"
                key={v.code}
                className={`voucher-item ${isSelected ? 'active' : ''} ${!isEligible ? 'ineligible' : ''}`}
                onClick={() => {
                  if (isSelected) {
                    onSelectCode(null);
                    setInputCode('');
                    setError('');
                  } else {
                    tryApplyCode(v.code);
                  }
                }}
              >
                <div className="voucher-top">
                  <span className="voucher-code mono">{v.code}</span>
                  <span className="voucher-action-tag">
                    {isSelected ? '✓ Đang dùng' : isEligible ? 'Chọn mã' : 'Thử áp mã'}
                  </span>
                </div>
                <span className="voucher-title">{v.label}</span>
                <span className="voucher-cond">{v.conditionText}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function PaymentMethodSelector({
  method,
  onMethodChange,
}: {
  method: Api.PaymentMethod;
  onMethodChange: (method: Api.PaymentMethod) => void;
}) {
  const methods: Api.PaymentMethod[] = ['WALLET', 'CARD'];
  return (
    <section className="brewlite-card">
      <div className="brewlite-card-header">
        <h2 className="brewlite-card-title">Phương thức thanh toán</h2>
        <span className="brewlite-card-subtitle">Không dùng tiền mặt</span>
      </div>
      <div className="methods-list">
        {methods.map(m => (
          <button
            type="button"
            key={m}
            className={`method-card ${method === m ? 'selected' : ''}`}
            onClick={() => onMethodChange(m)}
            role="radio"
            aria-checked={method === m}
          >
            <span className="method-icon">
              <PaymentIcon name={m === 'WALLET' ? 'wallet' : 'card'} size={22} />
            </span>
            <span className="method-text">
              <strong>
                {m === 'WALLET' ? 'Ví điện tử' : 'Thẻ ngân hàng'}
                <small className="mono">{m}</small>
              </strong>
              <span>
                {m === 'WALLET'
                  ? 'Ví điện tử (Cổng thanh toán mô phỏng)'
                  : 'Thẻ ATM nội địa / Visa / Mastercard (Cổng thanh toán mô phỏng)'}
              </span>
            </span>
            <span className="radio-circle">
              {method === m && <PaymentIcon name="check" size={13} />}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function PaymentDemoControls({
  outcome,
  onOutcomeChange,
  keyValue,
  onNewKey,
  onReplay,
}: {
  outcome: 'SUCCESS' | 'FAIL';
  onOutcomeChange: (outcome: 'SUCCESS' | 'FAIL') => void;
  keyValue: string;
  onNewKey: () => void;
  onReplay: () => void;
}) {
  const [open, setOpen] = useState(true);
  const outcomes: Array<'SUCCESS' | 'FAIL'> = ['SUCCESS', 'FAIL'];

  return (
    <section className="demo-box">
      <button
        type="button"
        className="demo-header"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <PaymentIcon name="flask" size={16} />
        <span>Cấu hình Kịch bản Thanh toán &amp; Idempotency</span>
        <span className="demo-tag">MOCK GATEWAY</span>
        <PaymentIcon name="chevron" size={15} />
      </button>
      {open && (
        <div className="demo-content">
          <div className="segmented-control">
            {outcomes.map(o => (
              <button
                type="button"
                className={outcome === o ? `active ${o === 'SUCCESS' ? 'success' : 'failure'}` : ''}
                key={o}
                onClick={() => onOutcomeChange(o)}
              >
                <PaymentIcon name={o === 'SUCCESS' ? 'check' : 'close'} size={14} />
                {o === 'SUCCESS' ? 'Giả lập Thành công (SUCCESS)' : 'Giả lập Thất bại (FAIL)'}
              </button>
            ))}
          </div>
          <div className="key-box-header">
            <span>Khóa chống thanh toán trùng (Idempotency-Key):</span>
            <span className="mono">PAY_ORDER</span>
          </div>
          <div className="key-value mono">{keyValue}</div>
          <div className="demo-btn-row">
            <button type="button" onClick={onNewKey}>
              <PaymentIcon name="refresh" size={14} />
              Tạo khóa UUID mới
            </button>
            <button type="button" onClick={onReplay}>
              <PaymentIcon name="layers" size={14} />
              Gửi lặp cùng khóa (Test Replay)
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function PaymentPriceSummary({
  subtotal,
  discount = 0,
  total: explicitTotal,
  applied = false,
  promotionCode = null,
  busy = false,
  isDemo = false,
  status = 'PENDING',
  failedResultVisible = false,
  verificationPending = false,
  onConfirm,
  onVerify,
  onScrollToResult,
}: {
  subtotal?: number;
  discount?: number;
  total?: number;
  applied?: boolean;
  promotionCode?: string | null;
  busy?: boolean;
  isDemo?: boolean;
  status?: Api.OrderStatus;
  failedResultVisible?: boolean;
  verificationPending?: boolean;
  onConfirm?: () => void;
  onVerify?: () => void;
  onScrollToResult?: () => void;
}) {
  const effectiveDiscount = applied || discount > 0 ? discount : 0;
  const resolvedSubtotal =
    subtotal !== undefined
      ? subtotal
      : explicitTotal !== undefined
        ? explicitTotal + effectiveDiscount
        : isDemo
          ? DEMO_SUBTOTAL
          : 0;
  const total =
    explicitTotal !== undefined ? explicitTotal : Math.max(0, resolvedSubtotal - effectiveDiscount);
  const points = calculateExpectedLoyaltyPoints(total);
  const paidOrFulfilling = isOrderPaidOrFulfilling(status);

  return (
    <section className="brewlite-card">
      <div className="brewlite-card-header">
        <h2 className="brewlite-card-title">Chi tiết thanh toán</h2>
        <span className="brewlite-card-subtitle">
          {isDemo ? 'Tạm tính (Dữ liệu mô phỏng)' : 'Tính bởi Server'}
        </span>
      </div>
      <div className="price-breakdown">
        <div className="price-row">
          <span>Tạm tính</span>
          <span className="mono">{formatVnd(resolvedSubtotal)}</span>
        </div>
        <div className="price-row">
          <span>
            Giảm giá khuyến mãi
            {promotionCode && <span className="promo-badge mono">{promotionCode}</span>}
          </span>
          <span className="mono green-text">
            {effectiveDiscount > 0 ? `−${formatVnd(effectiveDiscount)}` : '0 ₫'}
          </span>
        </div>
        <div className="total-row">
          <strong>Tổng thanh toán</strong>
          <strong className="mono">{formatVnd(total)}</strong>
        </div>
      </div>

      <div className="loyalty-box">
        <PaymentIcon name="star" size={16} />
        <span>
          {isDemo ? (
            <>
              Dự kiến tích lũy <strong>+{points} điểm thưởng</strong> (Mô phỏng)
            </>
          ) : (
            <>
              Tích lũy <strong>+{points} điểm thưởng</strong> khi đơn hoàn thành (COMPLETED)
            </>
          )}
        </span>
        <small>10.000 ₫ = 1 điểm</small>
      </div>

      {verificationPending ? (
        <div style={{ marginTop: 20 }}>
          <PaymentButton
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onVerify ?? onScrollToResult}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            <PaymentIcon name="refresh" size={16} />
            {busy ? 'Đang xác minh trạng thái đơn...' : 'Thử xác minh lại trạng thái đơn'}
          </PaymentButton>
          <div className="secure-note">
            <PaymentIcon name="shield" size={14} />
            <span>Đang chờ xác minh trạng thái đơn mới nhất, không gửi thêm thanh toán</span>
          </div>
        </div>
      ) : paidOrFulfilling ? (
        <div style={{ marginTop: 20 }}>
          <PaymentButton
            type="button"
            variant="applied"
            onClick={onScrollToResult}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            <PaymentIcon name="check" size={16} />
            Đã thanh toán ({status}) • Xem biên nhận bên dưới ↓
          </PaymentButton>
          <div className="secure-note">
            <PaymentIcon name="shield" size={14} />
            <span>Đơn hàng đã được xác nhận thanh toán thành công</span>
          </div>
        </div>
      ) : status === 'PAYMENT_FAILED' && failedResultVisible ? (
        <div style={{ marginTop: 20 }}>
          <PaymentButton
            type="button"
            variant="secondary"
            onClick={onScrollToResult}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            Thanh toán thất bại • Xem chi tiết bên dưới ↓
          </PaymentButton>
          <div className="secure-note">
            <PaymentIcon name="shield" size={14} />
            <span>Giỏ hàng được bảo vệ, bạn có thể thử lại bên dưới</span>
          </div>
        </div>
      ) : onConfirm ? (
        <div style={{ marginTop: 20 }}>
          <PaymentButton type="button" disabled={busy} onClick={onConfirm}>
            {busy ? (
              <>
                <span className="spinner" />
                Đang xử lý thanh toán...
              </>
            ) : (
              <>
                Xác nhận thanh toán • <span className="mono">{formatVnd(total)}</span>
              </>
            )}
          </PaymentButton>
          <div className="secure-note">
            <PaymentIcon name="shield" size={14} />
            <span>Bảo vệ chống trừ tiền 2 lần bằng Idempotency-Key</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function PaymentReceiptCard({
  orderCode,
  failed = false,
  orderStatus,
  reservationStatus,
  paymentStatus,
  method = 'WALLET',
  applied = false,
  promotionCode = null,
  subtotal,
  discount = 0,
  total: explicitTotal,
  idempotencyKey,
  payment,
  order,
  isDemo = false,
}: {
  orderCode?: string;
  failed?: boolean;
  orderStatus?: Api.OrderStatus;
  reservationStatus?: Api.Order['reservationStatus'];
  paymentStatus?: Api.Payment['status'];
  method?: Api.PaymentMethod;
  applied?: boolean;
  promotionCode?: string | null;
  subtotal?: number;
  discount?: number;
  total?: number;
  idempotencyKey?: string;
  payment?: Partial<Api.Payment> | null;
  order?: Partial<Api.Order> | null;
  isDemo?: boolean;
}) {
  const resolvedOrderStatus: Api.OrderStatus =
    order?.status ?? orderStatus ?? (failed ? 'PAYMENT_FAILED' : 'PAID');
  const paidOrFulfilling = isOrderPaidOrFulfilling(resolvedOrderStatus, payment?.status ?? paymentStatus);
  const isFailed = !paidOrFulfilling && (failed || resolvedOrderStatus === 'PAYMENT_FAILED' || payment?.status === 'FAILED');

  const resolvedPaymentStatus: Api.Payment['status'] =
    payment?.status ?? paymentStatus ?? (isFailed ? 'FAILED' : 'SUCCEEDED');
  const resolvedReservationStatus = resolveReservationStatus(
    resolvedOrderStatus,
    order?.reservationStatus ?? reservationStatus,
  );
  const resolvedOrderCode =
    order?.code ?? orderCode ?? (isDemo ? DEFAULT_ORDER_CODE : order?.id ?? '');
  const resolvedMethod: Api.PaymentMethod = payment?.method ?? method ?? 'WALLET';
  const resolvedPromoCode =
    order?.promotionCode !== undefined ? order.promotionCode : promotionCode;
  const effectiveDiscount =
    order?.discount !== undefined ? order.discount : applied || discount > 0 ? discount : 0;

  const resolvedTotal =
    payment?.amount ??
    order?.total ??
    explicitTotal ??
    Math.max(0, (order?.subtotal ?? subtotal ?? (isDemo ? DEMO_SUBTOTAL : 0)) - effectiveDiscount);

  const resolvedSubtotal =
    order?.subtotal ?? subtotal ?? resolvedTotal + effectiveDiscount;

  const resolvedIdempotencyKey =
    payment?.idempotencyKey ?? idempotencyKey ?? (isDemo ? DEFAULT_IDEMPOTENCY_KEY : '');

  return (
    <section className="brewlite-card" data-testid="payment-receipt-card">
      <div className="brewlite-card-header">
        <h2 className="brewlite-card-title">
          {isFailed ? 'Thông tin đơn hàng' : 'Biên nhận thanh toán'}
        </h2>
        <PaymentBadge tone={isFailed ? 'rose' : 'green'}>
          {resolvedOrderStatus}
        </PaymentBadge>
      </div>

      <div className="receipt-rows">
        <div className="receipt-row">
          <span>Mã đơn hàng</span>
          <strong className="mono">#{resolvedOrderCode}</strong>
        </div>
        <div className="receipt-row">
          <span>Trạng thái giữ kho</span>
          <strong className="mono">
            {resolvedReservationStatus === 'RELEASED'
              ? 'RELEASED (Chưa trừ kho)'
              : isDemo
                ? `${resolvedReservationStatus} (Mô phỏng - Chưa trừ kho thật)`
                : `${resolvedReservationStatus} (Đã trừ kho)`}
          </strong>
        </div>
        <div className="receipt-row">
          <span>Phương thức thanh toán</span>
          <strong>
            {resolvedMethod === 'WALLET' ? 'Ví điện tử (WALLET)' : 'Thẻ ngân hàng (CARD)'}
          </strong>
        </div>
        <div className="receipt-row">
          <span>Trạng thái giao dịch</span>
          <strong className="mono">
            {resolvedPaymentStatus === 'FAILED'
              ? 'FAILED'
              : isDemo
                ? 'SUCCEEDED (Mô phỏng)'
                : resolvedPaymentStatus}
          </strong>
        </div>
        <div className="receipt-row">
          <span>Idempotency-Key</span>
          <strong className="mono" style={{ fontSize: 12 }}>
            {resolvedIdempotencyKey}
          </strong>
        </div>
        <div className="receipt-divider" />
        <div className="receipt-row">
          <span>Tạm tính</span>
          <span className="mono">{formatVnd(resolvedSubtotal)}</span>
        </div>
        <div className="receipt-row">
          <span>Mã khuyến mãi {resolvedPromoCode ? `(${resolvedPromoCode})` : ''}</span>
          <span className="mono" style={{ color: 'var(--green)' }}>
            {effectiveDiscount > 0 ? `−${formatVnd(effectiveDiscount)}` : '0 ₫'}
          </span>
        </div>
        <div className="total-row">
          <strong>{isFailed ? 'Số tiền cần thanh toán' : 'Tổng đã thanh toán'}</strong>
          <strong className="mono">{formatVnd(resolvedTotal)}</strong>
        </div>
      </div>
    </section>
  );
}

export type PaymentExecutionParams = {
  orderId: string;
  method: Api.PaymentMethod;
  idempotencyKey: string;
  mockOutcome?: 'SUCCESS' | 'FAIL';
};

export type PaymentCommittedPayload = {
  status: 'PAID' | 'PAYMENT_FAILED';
  orderStatus?: Api.OrderStatus;
  method: Api.PaymentMethod;
  mockOutcome: 'SUCCESS' | 'FAIL';
  idempotencyKey: string;
  replayed: boolean;
  order?: Api.Order | null;
  payment?: Api.Payment | null;
  verified?: boolean;
};

export type PaymentCheckoutPhoneProps = {
  initialState?: number;
  order?: CheckoutOrderData;
  paymentResult?: Api.PaymentResult;
  /**
   * Idempotency-Key for the current payment attempt, supplied by the parent checkout (TV2).
   * When omitted in integration mode the widget generates a fresh UUID per order / per new attempt.
   * The fixed demo key is used ONLY when isDemo === true.
   */
  idempotencyKey?: string;
  isDemo?: boolean;
  mockOutcome?: 'SUCCESS' | 'FAIL';
  onMockOutcomeChange?: (outcome: 'SUCCESS' | 'FAIL') => void;
  onExecutePayment?: (params: PaymentExecutionParams) => Promise<PaymentExecutionOutcome>;
  onVerifyOrder?: (orderId: string) => Promise<Api.Order>;
  onNotify?: (message: string) => void;
  onPaymentCommitted?: (payload: PaymentCommittedPayload) => void;
};

function safeScrollToTop() {
  if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

/**
 * Callback-driven Checkout & Payment Widget that can be embedded in TV2's checkout
 * or rendered as the standalone Payment page.
 */
export function PaymentCheckoutPhone({
  initialState = 0,
  order,
  paymentResult,
  idempotencyKey: idempotencyKeyProp,
  isDemo,
  mockOutcome,
  onMockOutcomeChange,
  onExecutePayment,
  onVerifyOrder,
  onNotify,
  onPaymentCommitted,
}: PaymentCheckoutPhoneProps) {
  const isDemoMode = isDemo ?? !onExecutePayment;

  const [state, setState] = useState(initialState);
  const [method, setMethod] = useState<Api.PaymentMethod>(
    paymentResult?.payment?.method ?? 'WALLET',
  );
  const [internalOutcome, setInternalOutcome] = useState<'SUCCESS' | 'FAIL'>('SUCCESS');
  const outcome = mockOutcome ?? internalOutcome;
  const [selectedPromoCode, setSelectedPromoCode] = useState<string | null>(
    paymentResult?.order?.promotionCode !== undefined
      ? paymentResult.order.promotionCode
      : order?.promotionCode !== undefined
        ? order.promotionCode
        : isDemoMode
          ? DEMO_PROMO_CODE
          : null,
  );
  const [keyValue, setKeyValue] = useState<string>(
    () =>
      paymentResult?.payment?.idempotencyKey ??
      idempotencyKeyProp ??
      (isDemoMode ? DEFAULT_IDEMPOTENCY_KEY : createPaymentIdempotencyKey()),
  );
  // Order of the failed attempt kept as money/items snapshot while a new attempt (new key) is prepared.
  const [retryOrder, setRetryOrder] = useState<Api.Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [replayed, setReplayed] = useState(false);
  const [details, setDetails] = useState(false);

  // States for real API integration & replay verification
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationErrorText, setVerificationErrorText] = useState<string | null>(null);
  const [confirmedPayment, setConfirmedPayment] = useState<Api.Payment | null>(
    paymentResult?.payment ?? null,
  );
  const [confirmedOrder, setConfirmedOrder] = useState<Api.Order | null>(
    paymentResult?.order ?? null,
  );
  const [earnedLoyaltyPoints, setEarnedLoyaltyPoints] = useState<number | null>(
    typeof paymentResult?.loyaltyPointsEarned === 'number'
      ? paymentResult.loyaltyPointsEarned
      : null,
  );

  // Adjust state during render when props change (standard React pattern without effect cascade)
  const [prevOrderId, setPrevOrderId] = useState(order?.id);
  const [prevOrderPromo, setPrevOrderPromo] = useState(order?.promotionCode);
  const [prevIdempotencyProp, setPrevIdempotencyProp] = useState(idempotencyKeyProp);

  if (!isDemoMode && order?.id !== prevOrderId) {
    setPrevOrderId(order?.id);
    setPrevIdempotencyProp(idempotencyKeyProp);
    setKeyValue(idempotencyKeyProp ?? createPaymentIdempotencyKey());
    setRetryOrder(null);
    setConfirmedOrder(null);
    setConfirmedPayment(null);
    setState(initialState ?? 0);
    setReplayed(false);
    setVerificationPending(false);
    setVerificationErrorText(null);
    setEarnedLoyaltyPoints(null);
    setBusy(false);
    setDetails(false);
    setSelectedPromoCode(
      order?.promotionCode !== undefined
        ? order.promotionCode
        : isDemoMode
          ? DEMO_PROMO_CODE
          : null,
    );
  }

  if (!isDemoMode && order?.promotionCode !== prevOrderPromo) {
    setPrevOrderPromo(order?.promotionCode);
    if (order?.promotionCode !== undefined) {
      setSelectedPromoCode(order.promotionCode);
    }
  }

  if (
    !isDemoMode &&
    idempotencyKeyProp !== undefined &&
    idempotencyKeyProp !== prevIdempotencyProp
  ) {
    setPrevIdempotencyProp(idempotencyKeyProp);
    setKeyValue(idempotencyKeyProp);
    setConfirmedPayment(null);
    setConfirmedOrder(null);
    setRetryOrder(null);
    setReplayed(false);
    setVerificationPending(false);
    setVerificationErrorText(null);
    setBusy(false);
    if (state !== 0) {
      setState(0);
    }
  }

  const activeRequestIdRef = useRef<number>(0);
  const activeOrderIdRef = useRef<string | undefined>(order?.id);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      activeRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    activeOrderIdRef.current = order?.id;
    activeRequestIdRef.current += 1;
  }, [order?.id, idempotencyKeyProp]);

  const resultRef = useRef<HTMLDivElement | null>(null);

  const scrollToResult = () => {
    if (resultRef.current && typeof resultRef.current.scrollIntoView === 'function') {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    if ((state !== 0 || verificationPending) && resultRef.current) {
      if (typeof resultRef.current.scrollIntoView === 'function') {
        resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [state, verificationPending]);

  const cache = useRef(
    new Map<
      string,
      {
        state: number;
        method: Api.PaymentMethod;
        promoCode: string | null;
        outcome: 'SUCCESS' | 'FAIL';
      }
    >(),
  );

  const notify = (msg: string) => {
    onNotify?.(msg);
  };

  // Resolve order & payment fields: scoped strictly to the currently displayed order
  const snapshotOrder =
    confirmedOrder && (!order?.id || confirmedOrder.id === order.id)
      ? confirmedOrder
      : retryOrder && (!order?.id || retryOrder.id === order.id)
        ? retryOrder
        : null;

  const effectiveOrderId =
    order?.id ?? snapshotOrder?.id ?? (isDemoMode ? '44444444-4444-4444-8444-444444444444' : '');
  const effectiveOrderCode =
    order?.code ??
    snapshotOrder?.code ??
    (isDemoMode ? DEFAULT_ORDER_CODE : effectiveOrderId);

  const effectiveMethod: Api.PaymentMethod =
    confirmedPayment && (!order?.id || confirmedPayment.orderId === order.id)
      ? confirmedPayment.method
      : method;
  const effectiveIdempotencyKey =
    confirmedPayment && (!order?.id || confirmedPayment.orderId === order.id)
      ? confirmedPayment.idempotencyKey
      : keyValue;

  const activePromo = AVAILABLE_PROMOTIONS.find(p => p.code === selectedPromoCode) ?? null;
  const effectivePromoCode =
    snapshotOrder !== null
      ? (snapshotOrder.promotionCode ?? null)
      : selectedPromoCode;

  const rawSubtotal =
    snapshotOrder?.subtotal ??
    order?.subtotal ??
    (isDemoMode ? DEMO_SUBTOTAL : undefined);

  const effectiveDiscount =
    snapshotOrder?.discount !== undefined
      ? snapshotOrder.discount
      : order?.discount !== undefined && selectedPromoCode === (order.promotionCode ?? null)
        ? order.discount
        : rawSubtotal !== undefined && (isDemoMode || selectedPromoCode !== null)
          ? computePromotionDiscount(rawSubtotal, activePromo)
          : 0;

  const effectiveTotal =
    confirmedPayment && (!order?.id || confirmedPayment.orderId === order.id)
      ? confirmedPayment.amount
      : snapshotOrder?.total ??
        (order?.total !== undefined && selectedPromoCode === (order.promotionCode ?? null)
          ? order.total
          : Math.max(0, (rawSubtotal ?? 0) - effectiveDiscount));

  const effectiveSubtotal =
    rawSubtotal !== undefined ? rawSubtotal : effectiveTotal + effectiveDiscount;

  const totalFormatted = formatVnd(effectiveTotal);
  const expectedPoints = calculateExpectedLoyaltyPoints(effectiveTotal);
  const finalPoints = earnedLoyaltyPoints && earnedLoyaltyPoints > 0 ? earnedLoyaltyPoints : expectedPoints;

  const displayOrderStatus: Api.OrderStatus = verificationPending
    ? (order?.status ?? 'PENDING')
    : retryOrder && (!order?.id || retryOrder.id === order.id) && !confirmedOrder
      ? 'PENDING'
      : confirmedOrder && (!order?.id || confirmedOrder.id === order.id)
        ? confirmedOrder.status
        : (state === 1 ? 'PAID' : state === 2 ? 'PAYMENT_FAILED' : (order?.status ?? 'PENDING'));

  const displayReservationStatus =
    (confirmedOrder && (!order?.id || confirmedOrder.id === order.id)
      ? confirmedOrder.reservationStatus
      : undefined) ?? order?.reservationStatus;

  const displayItems =
    snapshotOrder?.items && snapshotOrder.items.length > 0
      ? snapshotOrder.items
      : order?.items;

  const pay = async () => {
    if (busy) {
      notify('Giao dịch đang xử lý. Vui lòng không nhấn liên tiếp.');
      return;
    }

    if (onExecutePayment) {
      const currentRequestId = ++activeRequestIdRef.current;
      const requestOrderId = effectiveOrderId;
      const requestKey = keyValue;
      setBusy(true);

      const isCurrent = () => {
        if (!isMountedRef.current) {
          return false;
        }
        if (isDemoMode) {
          return true;
        }
        const matchesOrder =
          activeOrderIdRef.current === requestOrderId ||
          (!activeOrderIdRef.current && !requestOrderId);
        return activeRequestIdRef.current === currentRequestId && matchesOrder;
      };

      try {
        const executionOutcome = await onExecutePayment({
          orderId: requestOrderId,
          method,
          idempotencyKey: requestKey,
          mockOutcome: outcome,
        });

        // Guard against late response from an obsolete request or different order
        if (!isCurrent()) {
          return;
        }

        setBusy(false);
        setReplayed(Boolean(executionOutcome.replayed));

        const paymentSnapshot = executionOutcome.result?.payment ?? null;

        if (executionOutcome.replayed && !executionOutcome.verified) {
          // Per business-rules.md 7.9: Do NOT trust stale snapshot from result.order
          // when replay verification failed. Do NOT claim payment succeeded or clear cart.
          setConfirmedPayment(paymentSnapshot);
          setConfirmedOrder(null);
          setState(0);
          setVerificationPending(true);
          setVerificationErrorText(
            executionOutcome.verificationError ??
              'Giao dịch gửi lại trùng khóa nhưng chưa xác minh được trạng thái đơn mới.',
          );
          notify('Giao dịch trùng lặp nhưng chưa xác minh được đơn mới. Giỏ hàng chưa bị xóa.');
          return;
        }

        setVerificationPending(false);
        setVerificationErrorText(null);

        const latest = executionOutcome.latestOrder ?? executionOutcome.result?.order ?? null;
        setConfirmedPayment(paymentSnapshot);
        setConfirmedOrder(latest);
        if (paymentSnapshot?.method) {
          setMethod(paymentSnapshot.method);
        }
        if (typeof executionOutcome.result?.loyaltyPointsEarned === 'number') {
          setEarnedLoyaltyPoints(executionOutcome.result.loyaltyPointsEarned);
        }

        if (isOrderPaidOrFulfilling(latest?.status, paymentSnapshot?.status)) {
          setState(1);
          notify(
            executionOutcome.replayed
              ? `Idempotency-Replayed: true — Đơn hàng đang ở trạng thái ${latest?.status ?? 'PAID'}, không trừ tiền 2 lần!`
              : 'Thanh toán thành công qua API!',
          );
          onPaymentCommitted?.({
            status: 'PAID',
            orderStatus: latest?.status ?? 'PAID',
            method: paymentSnapshot?.method ?? method,
            mockOutcome: outcome,
            idempotencyKey: paymentSnapshot?.idempotencyKey ?? requestKey,
            replayed: executionOutcome.replayed,
            order: latest,
            payment: paymentSnapshot,
            verified: true,
          });
        } else {
          setState(2);
          notify('Thanh toán thất bại từ API.');
          onPaymentCommitted?.({
            status: 'PAYMENT_FAILED',
            orderStatus: latest?.status ?? 'PAYMENT_FAILED',
            method: paymentSnapshot?.method ?? method,
            mockOutcome: outcome,
            idempotencyKey: paymentSnapshot?.idempotencyKey ?? requestKey,
            replayed: executionOutcome.replayed,
            order: latest,
            payment: paymentSnapshot,
            verified: true,
          });
        }
      } catch (err: unknown) {
        if (!isCurrent()) {
          return;
        }
        setBusy(false);
        const msg = err instanceof Error ? err.message : 'Không thể kết nối đến máy chủ thanh toán.';
        notify(msg);
      }
      return;
    }

    // Demo simulation mode
    const cached = cache.current.get(keyValue);
    if (cached) {
      if (
        cached.method !== method ||
        cached.promoCode !== selectedPromoCode ||
        cached.outcome !== outcome
      ) {
        notify('409 IDEMPOTENCY_KEY_REUSED: Khóa này đã dùng cho dữ liệu khác. Hãy tạo key mới!');
        return;
      }
      setState(cached.state);
      setReplayed(true);
      notify('Idempotency-Replayed: true — Đã trả lại kết quả mô phỏng cũ, không trừ tiền 2 lần!');
      onPaymentCommitted?.({
        status: cached.state === 1 ? 'PAID' : 'PAYMENT_FAILED',
        orderStatus: cached.state === 1 ? 'PAID' : 'PAYMENT_FAILED',
        method,
        mockOutcome: outcome,
        idempotencyKey: keyValue,
        replayed: true,
        verified: true,
      });
      return;
    }

    setBusy(true);
    setTimeout(() => {
      const next = outcome === 'SUCCESS' ? 1 : 2;
      cache.current.set(keyValue, {
        state: next,
        method,
        promoCode: selectedPromoCode,
        outcome,
      });
      setState(next);
      setBusy(false);
      setReplayed(false);
      onPaymentCommitted?.({
        status: next === 1 ? 'PAID' : 'PAYMENT_FAILED',
        orderStatus: next === 1 ? 'PAID' : 'PAYMENT_FAILED',
        method,
        mockOutcome: outcome,
        idempotencyKey: keyValue,
        replayed: false,
        verified: true,
      });
    }, 500);
  };

  const retryVerification = async () => {
    if (!onVerifyOrder) {
      notify('Không có hàm xác minh đơn hàng.');
      return;
    }
    if (busy) {
      notify('Giao dịch đang xử lý. Vui lòng không nhấn liên tiếp.');
      return;
    }
    const currentRequestId = ++activeRequestIdRef.current;
    const requestOrderId = effectiveOrderId;
    setBusy(true);

    const isCurrent = () => {
      if (!isMountedRef.current) {
        return false;
      }
      if (isDemoMode) {
        return true;
      }
      const matchesOrder =
        activeOrderIdRef.current === requestOrderId ||
        (!activeOrderIdRef.current && !requestOrderId);
      return activeRequestIdRef.current === currentRequestId && matchesOrder;
    };

    try {
      const fresh = await onVerifyOrder(requestOrderId);
      if (!isCurrent()) {
        return;
      }
      setConfirmedOrder(fresh);
      setVerificationPending(false);
      setVerificationErrorText(null);
      setBusy(false);

      if (isOrderPaidOrFulfilling(fresh.status, confirmedPayment?.status)) {
        setState(1);
        notify(`Xác minh thành công! Đơn hàng đang ở trạng thái ${fresh.status}.`);
        onPaymentCommitted?.({
          status: 'PAID',
          orderStatus: fresh.status,
          method: confirmedPayment?.method ?? method,
          mockOutcome: outcome,
          idempotencyKey: confirmedPayment?.idempotencyKey ?? keyValue,
          replayed: true,
          order: fresh,
          payment: confirmedPayment,
          verified: true,
        });
      } else if (fresh.status === 'PAYMENT_FAILED') {
        setState(2);
        notify('Xác minh hoàn tất: Đơn hàng ở trạng thái PAYMENT_FAILED.');
        onPaymentCommitted?.({
          status: 'PAYMENT_FAILED',
          orderStatus: fresh.status,
          method: confirmedPayment?.method ?? method,
          mockOutcome: outcome,
          idempotencyKey: confirmedPayment?.idempotencyKey ?? keyValue,
          replayed: true,
          order: fresh,
          payment: confirmedPayment,
          verified: true,
        });
      } else {
        setState(0);
        notify(`Xác minh hoàn tất: Đơn hàng ở trạng thái ${fresh.status}.`);
      }
    } catch (err: unknown) {
      if (!isCurrent()) {
        return;
      }
      setBusy(false);
      const msg =
        err instanceof Error ? err.message : 'Chưa thể xác minh trạng thái đơn hàng. Vui lòng thử lại.';
      setVerificationErrorText(msg);
      notify(msg);
    }
  };

  const reset = () => {
    activeRequestIdRef.current += 1;
    setBusy(false);
    setState(0);
    setDetails(false);
    setReplayed(false);
    setVerificationPending(false);
    setVerificationErrorText(null);
    setConfirmedPayment(null);
    setConfirmedOrder(null);
    setRetryOrder(null);
    setEarnedLoyaltyPoints(null);
    if (!isDemoMode) {
      const freshKey = idempotencyKeyProp ?? createPaymentIdempotencyKey();
      setKeyValue(freshKey);
    }
    safeScrollToTop();
  };

  const retryWithNewKey = () => {
    activeRequestIdRef.current += 1;
    // Keep the failed order as price/items snapshot; backend re-reserves stock and moves the order state.
    if (confirmedOrder && (!order?.id || confirmedOrder.id === order.id)) {
      setRetryOrder(confirmedOrder);
    }
    setConfirmedOrder(null);
    const newKey = createPaymentIdempotencyKey();
    setKeyValue(newKey);
    setReplayed(false);
    setVerificationPending(false);
    setVerificationErrorText(null);
    setConfirmedPayment(null);
    setBusy(false);
    setState(0);
    setInternalOutcome('SUCCESS');
    onMockOutcomeChange?.('SUCCESS');
    notify('Đã tạo khóa mới! Giỏ hàng vẫn được giữ nguyên, chuyển kịch bản sang THÀNH CÔNG để thanh toán lại.');
    safeScrollToTop();
  };

  const headerBadgeTone = verificationPending
    ? 'amber'
    : isOrderPaidOrFulfilling(displayOrderStatus)
      ? 'green'
      : displayOrderStatus === 'PAYMENT_FAILED' || displayOrderStatus === 'CANCELLED'
        ? 'rose'
        : 'amber';

  return (
    <>
      <div className="brewlite-page-title-bar">
        <div className="brewlite-page-title-left">
          <div>
            <h1>
              {verificationPending
                ? 'Đang chờ xác minh trạng thái đơn'
                : state === 0
                  ? 'Thanh toán đơn hàng'
                  : state === 1
                    ? 'Thanh toán thành công'
                    : 'Kết quả thanh toán'}
            </h1>
            <p>
              {verificationPending
                ? 'Phản hồi replay đã nhận từ máy chủ, cần kiểm tra trạng thái đơn mới nhất trước khi hoàn tất.'
                : state === 0
                  ? 'Kiểm tra món, chọn hoặc nhập mã giảm giá và chọn phương thức thanh toán không tiền mặt.'
                  : state === 1
                    ? `Đơn hàng của bạn đang ở trạng thái ${displayOrderStatus}. Xem biên nhận chi tiết bên dưới.`
                    : 'Giao dịch chưa hoàn tất — giỏ hàng và mã ưu đãi của bạn vẫn được giữ nguyên.'}
            </p>
          </div>
        </div>
        <PaymentBadge tone={headerBadgeTone}>
          {displayOrderStatus}
        </PaymentBadge>
      </div>

      <div className="brewlite-checkout-grid">
        <PaymentOrderSummary
          orderCode={effectiveOrderCode}
          items={displayItems}
          isDemo={isDemoMode}
          status={displayOrderStatus}
          reservationStatus={displayReservationStatus}
          version={confirmedOrder?.version ?? order?.version ?? 0}
        />
        {isDemoMode && (
          <PaymentPromotionBox
            subtotal={effectiveSubtotal}
            selectedCode={effectivePromoCode}
            onSelectCode={state === 0 && !verificationPending ? setSelectedPromoCode : () => {}}
          />
        )}
        <PaymentMethodSelector
          method={effectiveMethod}
          onMethodChange={state === 0 && !verificationPending ? setMethod : () => {}}
        />
        <PaymentPriceSummary
          subtotal={effectiveSubtotal}
          discount={effectiveDiscount}
          total={effectiveTotal}
          applied={Boolean(effectivePromoCode) || effectiveDiscount > 0}
          promotionCode={effectivePromoCode}
          busy={busy}
          isDemo={isDemoMode}
          status={displayOrderStatus}
          failedResultVisible={!verificationPending && state === 2}
          verificationPending={verificationPending}
          onConfirm={pay}
          onVerify={retryVerification}
          onScrollToResult={scrollToResult}
        />
      </div>

      {verificationPending && (
        <div
          ref={resultRef}
          className="brewlite-result-container"
          data-testid="payment-verification-pending"
          style={{ marginTop: 40, scrollMarginTop: 90 }}
        >
          <PaymentNotice tone="amber" icon="shield">
            <strong>Chưa xác minh được trạng thái mới nhất sau Replay</strong>
            <p>
              Giao dịch gửi lại trùng khóa (<code>Idempotency-Replayed: true</code>) đã được ghi nhận,
              nhưng hệ thống chưa thể tải trạng thái đơn hàng mới nhất qua <code>GET /orders/:id</code>.
              Hệ thống <strong>không khẳng định thanh toán thành công</strong> từ snapshot cũ và giỏ hàng của bạn <strong>chưa bị xóa</strong>.
            </p>
            {verificationErrorText && (
              <p className="mono" style={{ fontSize: 12, marginTop: 4 }}>
                {verificationErrorText}
              </p>
            )}
            <div style={{ marginTop: 10 }}>
              <PaymentButton
                type="button"
                disabled={busy}
                onClick={retryVerification}
                className="compact"
              >
                <PaymentIcon name="refresh" size={14} />
                {busy ? 'Đang xác minh...' : 'Thử xác minh lại trạng thái đơn'}
              </PaymentButton>
            </div>
          </PaymentNotice>
        </div>
      )}

      {!verificationPending && state !== 0 && (
        <div
          ref={resultRef}
          className="brewlite-result-container"
          style={{ marginTop: 40, scrollMarginTop: 90 }}
        >
          <section className={`brewlite-card result-hero-card ${state === 2 ? 'failed' : ''}`}>
            <div className={`hero-circle ${state === 2 ? 'failed' : ''}`}>
              <PaymentIcon name={state === 1 ? 'check' : 'close'} size={34} />
            </div>
            <h2>{state === 1 ? 'Đặt hàng thành công!' : 'Thanh toán không thành công'}</h2>
            <p>
              {state === 1
                ? displayOrderStatus === 'PAID'
                  ? 'Mời bạn tới quầy nhận đồ uống khi đơn chuyển sang READY.'
                  : `Đơn hàng đã thanh toán thành công và đang ở trạng thái ${displayOrderStatus}.`
                : 'Cổng thanh toán mô phỏng trả về trạng thái lỗi (PAYMENT_FAILED).'}
            </p>
          </section>

          {state === 1 ? (
            <div className="reward-banner">
              <div className="reward-icon">
                <PaymentIcon name="star" size={24} />
              </div>
              <div>
                <strong>
                  {isDemoMode
                    ? `Dự kiến tích lũy +${finalPoints} điểm thưởng (Mô phỏng)`
                    : displayOrderStatus === 'COMPLETED' || (earnedLoyaltyPoints ?? 0) > 0
                      ? `Bạn vừa nhận được +${finalPoints} điểm tích lũy!`
                      : `Dự kiến tích lũy +${finalPoints} điểm thưởng khi đơn hoàn thành!`}
                </strong>
                <p>
                  {isDemoMode
                    ? 'Mô phỏng theo công thức: 10.000 ₫ = 1 điểm. Hệ thống chưa cộng vào cơ sở dữ liệu thật.'
                    : displayOrderStatus === 'COMPLETED' || (earnedLoyaltyPoints ?? 0) > 0
                      ? 'Đã ghi nhận điểm thưởng thành công vào tài khoản của bạn.'
                      : 'Điểm thưởng sẽ được cộng tự động vào tài khoản khi đơn hàng hoàn thành (COMPLETED).'}
                </p>
              </div>
            </div>
          ) : (
            <PaymentNotice tone="amber" icon="shield">
              <strong>Giỏ hàng của bạn vẫn được giữ nguyên!</strong>
              <p>
                Chưa trừ tiền, tồn kho và mã giảm giá {effectivePromoCode ?? ''} đã được hoàn trả tạm
                thời (RELEASED), điểm thưởng: 0 điểm.
              </p>
            </PaymentNotice>
          )}

          {replayed && (
            <PaymentNotice tone="indigo" icon="info">
              <strong>Kết quả được hoàn trả từ bộ nhớ đệm Idempotency</strong>
              <p>
                Hệ thống phát hiện yêu cầu trùng khóa nên trả lại biên nhận gốc, tuyệt đối không trừ
                tiền hay cộng điểm 2 lần.
              </p>
              <code>Idempotency-Replayed: true</code>
            </PaymentNotice>
          )}

          <PaymentReceiptCard
            orderCode={effectiveOrderCode}
            failed={state === 2}
            orderStatus={displayOrderStatus}
            reservationStatus={displayReservationStatus}
            paymentStatus={confirmedPayment?.status}
            method={effectiveMethod}
            applied={Boolean(effectivePromoCode) || effectiveDiscount > 0}
            promotionCode={effectivePromoCode}
            subtotal={effectiveSubtotal}
            discount={effectiveDiscount}
            total={effectiveTotal}
            idempotencyKey={effectiveIdempotencyKey}
            payment={confirmedPayment}
            order={confirmedOrder}
            isDemo={isDemoMode}
          />

          <div className="result-actions">
            {state === 1 || !isOrderPayableForRetry(displayOrderStatus) ? (
              <>
                <PaymentButton type="button" onClick={() => setDetails(true)}>
                  Xem chi tiết &amp; Theo dõi trạng thái đơn
                </PaymentButton>
                <PaymentButton
                  type="button"
                  variant="secondary"
                  onClick={safeScrollToTop}
                >
                  <PaymentIcon name="arrow" size={16} />
                  Cuộn lên xem lại đơn hàng ↑
                </PaymentButton>
                <PaymentButton type="button" variant="secondary" onClick={reset}>
                  Tạo đơn thanh toán mới
                </PaymentButton>
              </>
            ) : (
              <>
                <PaymentButton type="button" onClick={retryWithNewKey}>
                  <PaymentIcon name="refresh" size={17} />
                  Thử lại thanh toán với mã mới
                </PaymentButton>
                <PaymentButton
                  type="button"
                  variant="secondary"
                  onClick={safeScrollToTop}
                >
                  Cuộn lên kiểm tra đơn ↑
                </PaymentButton>
              </>
            )}
          </div>
        </div>
      )}

      {details && (
        <div className="modal-scrim">
          <div className="modal-box">
            <PaymentIcon name="coffee" size={34} />
            <h3>Chi tiết đơn hàng</h3>
            <p className="mono">#{effectiveOrderCode}</p>
            <PaymentBadge tone="green">
              {confirmedOrder
                ? `${confirmedOrder.status} (${confirmedOrder.reservationStatus})`
                : isDemoMode
                  ? 'PAID (Mô phỏng)'
                  : `${displayOrderStatus} (${resolveReservationStatus(displayOrderStatus, displayReservationStatus)})`}
            </PaymentBadge>
            <p>
              <strong>
                {normalizeDisplayItems(displayItems, isDemoMode)[0]?.name ?? 'Đơn hàng BrewLite'}
              </strong>
              <br />
              Tổng đã thanh toán: <strong className="mono">{totalFormatted}</strong>
              <br />
              {isDemoMode
                ? 'Đơn hàng thử nghiệm đã hoàn tất thanh toán ở chế độ mô phỏng.'
                : 'Quầy pha chế đã nhận đơn của bạn.'}
            </p>
            <PaymentButton type="button" onClick={() => setDetails(false)}>
              Đóng
            </PaymentButton>
          </div>
        </div>
      )}
    </>
  );
}

export function PaymentDesignSystemShowcase() {
  const [toast, setToast] = useState('');
  const [demoOutcome, setDemoOutcome] = useState<'SUCCESS' | 'FAIL'>('SUCCESS');

  const notify = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(''), 4000);
  };

  return (
    <div className="brewlite-payment-page">
      <header className="brewlite-header">
        <div className="brewlite-header-inner">
          <Link href="/" className="brewlite-brand">
            <span className="brewlite-brand-icon">
              <PaymentIcon name="coffee" size={22} />
            </span>
            <span>
              BrewLite<span className="brewlite-brand-dot">.</span>
            </span>
          </Link>
          <div className="brewlite-header-right">
            <span className="brewlite-cart-pill">
              <PaymentIcon name="coffee" size={16} />
              Giỏ hàng (2 món)
            </span>
          </div>
        </div>
      </header>

      <div className="demo-notice-banner">
        <PaymentIcon name="info" size={16} />
        <span>
          <strong>Chế độ thử nghiệm Demo:</strong> Giả lập kết quả cổng thanh toán:
        </span>
        <div className="demo-pill-group">
          <button
            type="button"
            className={`demo-pill ${demoOutcome === 'SUCCESS' ? 'active-success' : ''}`}
            onClick={() => {
              setDemoOutcome('SUCCESS');
              notify('Đã chuyển sang giả lập: Thanh toán THÀNH CÔNG (SUCCESS)');
            }}
          >
            ✓ Giả lập Thành công (SUCCESS)
          </button>
          <button
            type="button"
            className={`demo-pill ${demoOutcome === 'FAIL' ? 'active-fail' : ''}`}
            onClick={() => {
              setDemoOutcome('FAIL');
              notify('Đã chuyển sang giả lập: Thanh toán THẤT BẠI (FAIL) để kiểm tra luồng lỗi');
            }}
          >
            ✕ Giả lập Thất bại (FAIL)
          </button>
        </div>
      </div>

      <main className="brewlite-main">
        <PaymentCheckoutPhone
          initialState={0}
          isDemo={true}
          mockOutcome={demoOutcome}
          onMockOutcomeChange={setDemoOutcome}
          onNotify={notify}
        />
      </main>

      {toast && (
        <div className="global-toast" role="status">
          <PaymentIcon name="info" size={18} />
          <span>{toast}</span>
          <button type="button" onClick={() => setToast('')} aria-label="Đóng thông báo">
            <PaymentIcon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
