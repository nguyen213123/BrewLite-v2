'use client';

import { useState } from 'react';
import { MAX_QTY, lineTotal, lineUnitPrice, type CartLine } from '@/lib/cart/cart-store';
import { formatVnd } from '@/lib/format';

type Props = {
  line: CartLine;
  onQtyChange: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
};

const stepButton =
  'h-10 w-10 rounded-lg border border-[#263c30] font-semibold disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4';

export function CartLineRow({ line, onQtyChange, onRemove }: Props) {
  const [prevQty, setPrevQty] = useState(line.qty);
  const [val, setVal] = useState(String(line.qty));
  const [error, setError] = useState<string | null>(null);

  if (prevQty !== line.qty) {
    setPrevQty(line.qty);
    setVal(String(line.qty));
    setError(null);
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextText = e.target.value;
    setVal(nextText);

    if (nextText.trim() === '') {
      setError('Vui lòng nhập số lượng');
      return;
    }

    if (nextText.includes('.') || nextText.includes(',')) {
      setError('Số lượng không được là số thập phân');
      return;
    }

    const num = Number(nextText);
    if (!Number.isFinite(num)) {
      setError('Số lượng không hợp lệ');
      return;
    }

    if (!Number.isInteger(num)) {
      setError('Số lượng không được là số thập phân');
      return;
    }

    if (num === 0) {
      setError('Số lượng không được bằng 0');
      return;
    }

    if (num < 0) {
      setError('Số lượng không được nhỏ hơn 0');
      return;
    }

    if (num > MAX_QTY) {
      setError(`Số lượng tối đa là ${MAX_QTY}`);
      return;
    }

    try {
      onQtyChange(line.key, num);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Số lượng không hợp lệ');
    }
  };

  const handleBlur = () => {
    if (error || val.trim() === '') {
      setVal(String(line.qty));
      setError(null);
    }
  };

  const handleStep = (targetQty: number) => {
    try {
      onQtyChange(line.key, targetQty);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Số lượng không hợp lệ');
    }
  };

  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-[#cdd5c8] bg-white/60 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{line.productName}</h2>
        <p className="mt-1 text-sm">
          Size {line.size}
          {line.toppings.length > 0 && ` · ${line.toppings.map((t) => t.name).join(', ')}`}
        </p>
        <p className="mt-1 text-sm">{formatVnd(lineUnitPrice(line))} / ly</p>
      </div>
      <div className="flex flex-col sm:items-end">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2" role="group" aria-label={`Số lượng ${line.productName}`}>
            <button
              type="button"
              className={stepButton}
              onClick={() => handleStep(line.qty - 1)}
              disabled={line.qty <= 1}
              aria-label="Giảm số lượng"
            >
              −
            </button>
            <input
              type="text"
              inputMode="numeric"
              value={val}
              onChange={handleInputChange}
              onBlur={handleBlur}
              className={`h-10 w-16 rounded-lg border text-center font-semibold focus-visible:outline-2 ${
                error
                  ? 'border-red-500 bg-red-50 text-red-600 focus-visible:outline-red-500'
                  : 'border-[#263c30] bg-white focus-visible:outline-[#263c30]'
              }`}
              aria-label={`Nhập số lượng ${line.productName}`}
            />
            <button
              type="button"
              className={stepButton}
              onClick={() => handleStep(line.qty + 1)}
              disabled={line.qty >= MAX_QTY}
              aria-label="Tăng số lượng"
            >
              +
            </button>
          </div>
          <p className="w-28 text-right font-semibold">{formatVnd(lineTotal(line))}</p>
          <button
            type="button"
            onClick={() => onRemove(line.key)}
            className="text-sm font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-4"
            aria-label={`Xóa ${line.productName} khỏi giỏ hàng`}
          >
            Xóa
          </button>
        </div>
        {error && (
          <p className="mt-1.5 text-right text-xs font-semibold text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
