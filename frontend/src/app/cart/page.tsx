'use client';

import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { CartLineRow } from '@/components/cart/cart-line-row';
import { lineTotal, totalQty, useCartHydrated, useCartStore } from '@/lib/cart/cart-store';
import { formatVnd } from '@/lib/format';

export default function CartPage() {
  const hydrated = useCartHydrated();
  const lines = useCartStore((s) => s.lines);
  const setQty = useCartStore((s) => s.setQty);
  const removeItem = useCartStore((s) => s.removeItem);

  // Tổng ở client chỉ để hiển thị; số tiền cuối cùng do backend tính ở bước checkout.
  const estimate = lines.reduce((sum, l) => sum + lineTotal(l), 0);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <p className="mb-4 text-sm font-bold uppercase tracking-[0.25em]">BrewLite / Giỏ hàng</p>
        <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">Giỏ hàng của bạn.</h1>

        {!hydrated && <p className="mt-10 text-sm" role="status">Đang tải giỏ hàng…</p>}

        {hydrated && lines.length === 0 && (
          <section className="mt-10 rounded-2xl border border-[#cdd5c8] bg-white/60 p-6" aria-label="Giỏ hàng trống">
            <h2 className="text-lg font-semibold">Giỏ hàng đang trống</h2>
            <p className="mt-2 text-sm">Hãy chọn một đồ uống từ menu để bắt đầu.</p>
            <Link
              href="/"
              className="mt-5 inline-block rounded-lg bg-[#263c30] px-5 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              Xem menu
            </Link>
          </section>
        )}

        {hydrated && lines.length > 0 && (
          <>
            <ul className="mt-10 space-y-4" aria-label="Các món trong giỏ">
              {lines.map((line) => (
                <CartLineRow key={line.id || line.key} line={line} onQtyChange={setQty} onRemove={removeItem} />
              ))}
            </ul>
            <section className="mt-8 rounded-2xl border border-[#cdd5c8] bg-white/60 p-6" aria-label="Tạm tính">
              <div className="flex items-center justify-between">
                <span className="text-sm">{totalQty(lines)} ly · Tạm tính</span>
                <span className="text-2xl font-semibold" data-testid="cart-estimate">
                  {formatVnd(estimate)}
                </span>
              </div>
              <p className="mt-2 text-xs">Giá cuối cùng và ưu đãi được máy chủ tính lại khi thanh toán.</p>
              <Link
                href="/checkout"
                className="mt-5 inline-block rounded-lg bg-[#263c30] px-5 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                Thanh toán
              </Link>
            </section>
          </>
        )}
      </main>
    </>
  );
}
