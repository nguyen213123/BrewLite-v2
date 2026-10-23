'use client';

// Owner: TV5 — #10. Single-page Cashless Payment & Result Web UI + Reusable Checkout Callbacks.
import Link from 'next/link';
import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type * as Api from '@/lib/contracts/api.generated';
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

export const AVAILABLE_PROMOTIONS: readonly PromotionOption[] = [
  {
    code: 'SAVE10',
    label: 'Giảm 10% đơn hàng',
    conditionText: 'Đơn từ 50.000 ₫ · Giảm12.000 ₫',
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

const DEFAULT_ORDER_CODE = 'BL-20261022-A1B2C3D4';
const DEFAULT_IDEMPOTENCY_KEY = '77777777-7777-4777-8777-777777777777';

export type CheckoutOrderItem = {
  name: string;
  quantity?: number;
  unitPrice: number;
  details?: string;
};

export type CheckoutOrderData = {
  id?: string;
  code?: string;
  items?: CheckoutOrderItem[];
  subtotal: number;
  discount?: number;
  promotionCode?: string | null;
};

export function PaymentOrderSummary({
  orderCode = DEFAULT_ORDER_CODE,
  items,
  isDemo = true,
}: {
  orderCode?: string;
  items?: CheckoutOrderItem[];
  isDemo?: boolean;
}) {
  const displayItems: CheckoutOrderItem[] =
    items && items.length > 0
      ? items
      : [
          {
            name: '2 × Cappuccino',
            quantity: 2,
            unitPrice: 120_000,
            details: 'Size M (50.000 ₫ / ly) · Topping: Kem (+10.000 ₫ / ly)',
          },
        ];

  return (
    <section className="brewlite-card">
      <div className="brewlite-card-header">
        <h2 className="brewlite-card-title">Đơn hàng của bạn</h2>
        <PaymentBadge tone="amber">PENDING</PaymentBadge>
      </div>
      <div className="order-meta-bar">
        <span>
          Mã đơn: <strong className="mono">#{orderCode}</strong>
        </span>
        <span>{isDemo ? 'Dữ liệu mô phỏng · Giữ kho: HELD' : 'Giữ kho: HELD · Phiên bản: v0'}</span>
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
  subtotal = 120_000,
  selectedCode,
  onSelectCode,
}: {
  subtotal?: number;
  selectedCode: string | null;
  onSelectCode: (code: string | null) => void;
}) {
  const [inputCode, setInputCode] = useState(selectedCode ?? 'SAVE10');
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
                  ? 'MoMo / ZaloPay / VNPay QR — Thanh toán nhanh không tiền mặt'
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
  subtotal = 120_000,
  discount = 12_000,
  applied = true,
  promotionCode = 'SAVE10',
  busy = false,
  isDemo = true,
  onConfirm,
}: {
  subtotal?: number;
  discount?: number;
  applied?: boolean;
  promotionCode?: string | null;
  busy?: boolean;
  isDemo?: boolean;
  onConfirm?: () => void;
}) {
  const effectiveDiscount = applied ? discount : 0;
  const total = Math.max(0, subtotal - effectiveDiscount);
  const points = calculateExpectedLoyaltyPoints(total);

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
          <span className="mono">{formatVnd(subtotal)}</span>
        </div>
        <div className="price-row">
          <span>
            Giảm giá khuyến mãi
            {applied && promotionCode && <span className="promo-badge mono">{promotionCode}</span>}
          </span>
          <span className="mono green-text">
            {applied && effectiveDiscount > 0 ? `−${formatVnd(effectiveDiscount)}` : '0 ₫'}
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
              Tích lũy <strong>+{points} điểm thưởng</strong> sau khi đơn PAID
            </>
          )}
        </span>
        <small>10.000 ₫ = 1 điểm</small>
      </div>

      {onConfirm && (
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
      )}
    </section>
  );
}

export function PaymentReceiptCard({
  orderCode = DEFAULT_ORDER_CODE,
  failed = false,
  method = 'WALLET',
  applied = true,
  promotionCode = 'SAVE10',
  subtotal = 120_000,
  discount = 12_000,
  idempotencyKey = DEFAULT_IDEMPOTENCY_KEY,
  isDemo = true,
}: {
  orderCode?: string;
  failed?: boolean;
  method?: Api.PaymentMethod;
  applied?: boolean;
  promotionCode?: string | null;
  subtotal?: number;
  discount?: number;
  idempotencyKey?: string;
  isDemo?: boolean;
}) {
  const effectiveDiscount = applied ? discount : 0;
  const total = Math.max(0, subtotal - effectiveDiscount);

  return (
    <section className="brewlite-card">
      <div className="brewlite-card-header">
        <h2 className="brewlite-card-title">
          {failed ? 'Thông tin đơn hàng' : 'Biên nhận thanh toán'}
        </h2>
        <PaymentBadge tone={failed ? 'rose' : 'green'}>
          {failed ? 'PAYMENT_FAILED' : 'PAID'}
        </PaymentBadge>
      </div>

      <div className="receipt-rows">
        <div className="receipt-row">
          <span>Mã đơn hàng</span>
          <strong className="mono">#{orderCode}</strong>
        </div>
        <div className="receipt-row">
          <span>Trạng thái giữ kho</span>
          <strong className="mono">
            {failed
              ? 'RELEASED (Chưa trừ kho)'
              : isDemo
                ? 'CONSUMED (Mô phỏng - Chưa trừ kho thật)'
                : 'CONSUMED (Đã trừ kho)'}
          </strong>
        </div>
        <div className="receipt-row">
          <span>Phương thức thanh toán</span>
          <strong>
            {method === 'WALLET' ? 'Ví điện tử (WALLET)' : 'Thẻ ngân hàng (CARD)'}
          </strong>
        </div>
        <div className="receipt-row">
          <span>Trạng thái giao dịch</span>
          <strong className="mono">
            {failed ? 'FAILED' : isDemo ? 'SUCCEEDED (Mô phỏng)' : 'SUCCEEDED'}
          </strong>
        </div>
        <div className="receipt-row">
          <span>Idempotency-Key</span>
          <strong className="mono" style={{ fontSize: 12 }}>
            {idempotencyKey}
          </strong>
        </div>
        <div className="receipt-divider" />
        <div className="receipt-row">
          <span>Tạm tính</span>
          <span className="mono">{formatVnd(subtotal)}</span>
        </div>
        <div className="receipt-row">
          <span>Mã khuyến mãi {applied && promotionCode ? `(${promotionCode})` : ''}</span>
          <span className="mono" style={{ color: 'var(--green)' }}>
            {applied && effectiveDiscount > 0 ? `−${formatVnd(effectiveDiscount)}` : '0 ₫'}
          </span>
        </div>
        <div className="total-row">
          <strong>{failed ? 'Số tiền cần thanh toán' : 'Tổng đã thanh toán'}</strong>
          <strong className="mono">{formatVnd(total)}</strong>
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

export type PaymentCheckoutPhoneProps = {
  initialState?: number;
  order?: CheckoutOrderData;
  isDemo?: boolean;
  onExecutePayment?: (params: PaymentExecutionParams) => Promise<PaymentExecutionOutcome>;
  onVerifyOrder?: (orderId: string) => Promise<Api.Order>;
  onNotify?: (message: string) => void;
  onPaymentCommitted?: (payload: {
    status: 'PAID' | 'PAYMENT_FAILED';
    method: Api.PaymentMethod;
    mockOutcome: 'SUCCESS' | 'FAIL';
    idempotencyKey: string;
    replayed: boolean;
    order?: Api.Order | null;
    verified?: boolean;
  }) => void;
};

/**
 * Callback-driven Checkout & Payment Widget that can be embedded in TV2's checkout
 * or rendered as the standalone Payment page.
 */
export function PaymentCheckoutPhone({
  initialState = 0,
  order,
  isDemo,
  onExecutePayment,
  onVerifyOrder,
  onNotify,
  onPaymentCommitted,
}: PaymentCheckoutPhoneProps) {
  const isDemoMode = isDemo ?? !onExecutePayment;
  const subtotal = order?.subtotal ?? 120_000;
  const orderCode = order?.code ?? DEFAULT_ORDER_CODE;
  const orderId = order?.id ?? '44444444-4444-4444-8444-444444444444';

  const [state, setState] = useState(initialState);
  const [method, setMethod] = useState<Api.PaymentMethod>('WALLET');
  // Mock gateway outcome is fixed to SUCCESS in the customer UI; FAIL is exercised via API/tests.
  const outcome: 'SUCCESS' | 'FAIL' = 'SUCCESS';
  const [selectedPromoCode, setSelectedPromoCode] = useState<string | null>(
    order?.promotionCode !== undefined ? order.promotionCode : 'SAVE10',
  );
  const [keyValue, setKeyValue] = useState(DEFAULT_IDEMPOTENCY_KEY);
  const [busy, setBusy] = useState(false);
  const [replayed, setReplayed] = useState(false);
  const [details, setDetails] = useState(false);

  // States for real API integration & replay verification
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationErrorText, setVerificationErrorText] = useState<string | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<Api.Order | null>(null);
  const [earnedLoyaltyPoints, setEarnedLoyaltyPoints] = useState<number | null>(null);

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

  const activePromo = AVAILABLE_PROMOTIONS.find(p => p.code === selectedPromoCode) ?? null;
  const discount = computePromotionDiscount(subtotal, activePromo);
  const totalVnd = Math.max(0, subtotal - discount);
  const totalFormatted = formatVnd(totalVnd);
  const expectedPoints = calculateExpectedLoyaltyPoints(totalVnd);
  const finalPoints = earnedLoyaltyPoints ?? expectedPoints;

  const pay = async () => {
    if (busy) {
      notify('Giao dịch đang xử lý. Vui lòng không nhấn liên tiếp.');
      return;
    }

    if (onExecutePayment) {
      setBusy(true);
      try {
        const executionOutcome = await onExecutePayment({
          orderId,
          method,
          idempotencyKey: keyValue,
          mockOutcome: outcome,
        });

        setBusy(false);
        setReplayed(Boolean(executionOutcome.replayed));

        if (executionOutcome.replayed && !executionOutcome.verified) {
          setVerificationPending(true);
          setVerificationErrorText(
            executionOutcome.verificationError ??
              'Giao dịch gửi lại trùng khóa nhưng chưa xác minh được trạng thái đơn mới.',
          );
          notify('Giao dịch trùng lặp nhưng chưa xác minh được đơn mới. Giỏ hàng chưa bị xóa.');
          onPaymentCommitted?.({
            status: executionOutcome.result?.order?.status === 'PAID' ? 'PAID' : 'PAYMENT_FAILED',
            method,
            mockOutcome: outcome,
            idempotencyKey: keyValue,
            replayed: true,
            order: null, // Strictly do not trust stale snapshot
            verified: false,
          });
          return;
        }

        setVerificationPending(false);
        setVerificationErrorText(null);
        const latest = executionOutcome.latestOrder ?? executionOutcome.result?.order ?? null;
        setConfirmedOrder(latest);
        if (typeof executionOutcome.result?.loyaltyPointsEarned === 'number') {
          setEarnedLoyaltyPoints(executionOutcome.result.loyaltyPointsEarned);
        }

        if (latest?.status === 'PAID') {
          setState(1);
          notify(
            executionOutcome.replayed
              ? 'Idempotency-Replayed: true — Đơn hàng đã thanh toán trước đó, không trừ tiền 2 lần!'
              : 'Thanh toán thành công qua API!',
          );
          onPaymentCommitted?.({
            status: 'PAID',
            method,
            mockOutcome: outcome,
            idempotencyKey: keyValue,
            replayed: executionOutcome.replayed,
            order: latest,
            verified: true,
          });
        } else {
          setState(2);
          notify('Thanh toán thất bại từ API.');
          onPaymentCommitted?.({
            status: 'PAYMENT_FAILED',
            method,
            mockOutcome: outcome,
            idempotencyKey: keyValue,
            replayed: executionOutcome.replayed,
            order: latest,
            verified: true,
          });
        }
      } catch (err: unknown) {
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
        method,
        mockOutcome: outcome,
        idempotencyKey: keyValue,
        replayed: true,
        verified: true,
      });
      return;
    }

    setBusy(true);
    window.setTimeout(() => {
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
    setBusy(true);
    try {
      const fresh = await onVerifyOrder(orderId);
      setConfirmedOrder(fresh);
      setVerificationPending(false);
      setVerificationErrorText(null);
      setBusy(false);
      if (fresh.status === 'PAID') {
        setState(1);
        notify('Xác minh thành công! Đơn hàng đã ở trạng thái PAID.');
        onPaymentCommitted?.({
          status: 'PAID',
          method,
          mockOutcome: outcome,
          idempotencyKey: keyValue,
          replayed: true,
          order: fresh,
          verified: true,
        });
      } else {
        setState(2);
        notify(`Xác minh hoàn tất: Đơn hàng ở trạng thái ${fresh.status}`);
      }
    } catch (err: unknown) {
      setBusy(false);
      const msg = err instanceof Error ? err.message : 'Chưa thể xác minh trạng thái đơn hàng. Vui lòng thử lại.';
      notify(msg);
    }
  };

  const reset = () => {
    setState(0);
    setDetails(false);
    setReplayed(false);
    setVerificationPending(false);
  };

  const retryWithNewKey = () => {
    setKeyValue(createPaymentIdempotencyKey());
    setReplayed(false);
    setVerificationPending(false);
    setState(0);
    notify('Đơn hàng vẫn được giữ nguyên. Bạn có thể thanh toán lại ngay.');
  };

  return (
    <>
      <div className="brewlite-page-title-bar">
        <div className="brewlite-page-title-left">
          {state !== 0 && (
            <button
              type="button"
              className="brewlite-back-btn"
              onClick={reset}
              aria-label="Quay lại màn hình thanh toán"
            >
              <PaymentIcon name="arrow" size={18} />
            </button>
          )}
          <div>
            <h1>
              {state === 0
                ? 'Thanh toán đơn hàng'
                : state === 1
                  ? 'Xác nhận thanh toán thành công'
                  : 'Kết quả thanh toán'}
            </h1>
            <p>
              {state === 0
                ? 'Kiểm tra món, chọn hoặc nhập mã giảm giá và chọn phương thức thanh toán không tiền mặt.'
                : state === 1
                  ? 'Đơn hàng của bạn đã chuyển sang trạng thái PAID.'
                  : 'Giao dịch chưa hoàn tất — giỏ hàng và mã ưu đãi của bạn vẫn được giữ nguyên.'}
            </p>
          </div>
        </div>
        <PaymentBadge tone={state === 0 ? 'amber' : state === 1 ? 'green' : 'rose'}>
          {state === 0 ? 'PENDING' : state === 1 ? 'PAID' : 'PAYMENT_FAILED'}
        </PaymentBadge>
      </div>

      {state === 0 ? (
        <div className="brewlite-checkout-grid">
          <div className="brewlite-col">
            <PaymentOrderSummary
              orderCode={orderCode}
              items={order?.items}
              isDemo={isDemoMode}
            />
            <PaymentPromotionBox
              subtotal={subtotal}
              selectedCode={selectedPromoCode}
              onSelectCode={setSelectedPromoCode}
            />
            <PaymentMethodSelector method={method} onMethodChange={setMethod} />
          </div>
          <div className="brewlite-col">
            <PaymentPriceSummary
              subtotal={subtotal}
              discount={discount}
              applied={Boolean(selectedPromoCode)}
              promotionCode={selectedPromoCode}
              busy={busy}
              isDemo={isDemoMode}
              onConfirm={pay}
            />
          </div>
        </div>
      ) : (
        <div className="brewlite-result-container">
          <section className={`brewlite-card result-hero-card ${state === 2 ? 'failed' : ''}`}>
            <div className={`hero-circle ${state === 2 ? 'failed' : ''}`}>
              <PaymentIcon name={state === 1 ? 'check' : 'close'} size={34} />
            </div>
            <h2>{state === 1 ? 'Đặt hàng thành công!' : 'Thanh toán không thành công'}</h2>
            <p>
              {state === 1
                ? 'Mời bạn tới quầy nhận đồ uống khi đơn chuyển sang READY.'
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
                    : `Bạn vừa nhận được +${finalPoints} điểm tích lũy!`}
                </strong>
                <p>
                  {isDemoMode
                    ? 'Mô phỏng theo công thức: 10.000 ₫ = 1 điểm. Hệ thống chưa cộng vào cơ sở dữ liệu thật.'
                    : 'Đã ghi nhận điểm thưởng thành công vào tài khoản của bạn.'}
                </p>
              </div>
            </div>
          ) : (
            <PaymentNotice tone="amber" icon="shield">
              <strong>Giỏ hàng của bạn vẫn được giữ nguyên!</strong>
              <p>
                Chưa trừ tiền, tồn kho và mã giảm giá {selectedPromoCode ?? ''} đã được hoàn trả tạm
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

          {verificationPending && (
            <PaymentNotice tone="amber" icon="shield">
              <strong>Chưa xác minh được trạng thái mới nhất sau Replay</strong>
              <p>
                Giao dịch gửi lại trùng khóa đã được xử lý trên máy chủ, nhưng hệ thống chưa thể tải trạng thái đơn hàng mới nhất để đảm bảo an toàn. Giỏ hàng và ưu đãi của bạn <strong>chưa bị xóa</strong>.
              </p>
              {verificationErrorText && (
                <p className="mono" style={{ fontSize: 12, marginTop: 4 }}>
                  {verificationErrorText}
                </p>
              )}
              {onVerifyOrder && (
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
              )}
            </PaymentNotice>
          )}

          <PaymentReceiptCard
            failed={state === 2}
            method={method}
            applied={Boolean(selectedPromoCode)}
            promotionCode={selectedPromoCode}
            subtotal={subtotal}
            discount={discount}
            idempotencyKey={keyValue}
            isDemo={isDemoMode}
          />

          <div className="result-actions">
            {state === 1 ? (
              <>
                <PaymentButton type="button" onClick={() => setDetails(true)}>
                  Xem chi tiết &amp; Theo dõi trạng thái đơn
                </PaymentButton>
                <PaymentButton type="button" variant="secondary" onClick={reset}>
                  Quay lại trang Thanh toán
                </PaymentButton>
              </>
            ) : (
              <>
                <PaymentButton type="button" onClick={retryWithNewKey}>
                  <PaymentIcon name="refresh" size={17} />
                  Thử lại thanh toán
                </PaymentButton>
                <PaymentButton type="button" variant="secondary" onClick={reset}>
                  Quay lại giỏ hàng
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
            <p className="mono">#{orderCode}</p>
            <PaymentBadge tone="green">
              {confirmedOrder ? `${confirmedOrder.status} (${confirmedOrder.reservationStatus})` : 'PAID (Mô phỏng)'}
            </PaymentBadge>
            <p>
              <strong>{order?.items?.[0]?.name ?? '2 × Cappuccino (Size M)'}</strong>
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

  const notify = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 4000);
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
          <strong>Chế độ thử nghiệm Demo:</strong> Trang <code>/payments</code> đang sử dụng dữ liệu mô phỏng độc lập (Cappuccino 120.000 ₫). Không tự động trừ kho hay cộng điểm thật trên cơ sở dữ liệu cho đến khi tích hợp toàn bộ hệ thống.
        </span>
      </div>

      <main className="brewlite-main">
        <PaymentCheckoutPhone initialState={0} isDemo={true} onNotify={notify} />
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
