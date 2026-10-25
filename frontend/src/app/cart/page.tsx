'use client';

import Link from 'next/link';
import {
  useCartStore,
  useCartHydrated,
  lineUnitPrice,
  lineTotal,
  totalQty,
  MAX_QTY,
} from '@/lib/cart/cart-store';
import { formatVnd } from '@/components/payments/payment-api';
import { ProductImage } from '@/components/product-image';

export default function CartPage() {
  const { lines, setQty, removeItem, clear } = useCartStore();
  const hydrated = useCartHydrated();

  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const itemCount = totalQty(lines);
  const expectedPoints = Math.floor(subtotal / 10000);

  return (
    <div>
      {/* Banner tiêu đề Xanh Mint Pastel đồng bộ với trang chủ */}
      <section className="border-b border-[#b5dcc0] bg-[#cbe8d3]">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-4 px-6 py-8 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">BrewLite Mộc Vị / Giỏ hàng</p>
            <h1 className="mt-1.5 text-3xl font-extrabold tracking-tight text-[#4a2e20] sm:text-4xl">
              Đồ Uống Của Bạn
            </h1>
            <p className="mt-1 text-sm text-[#5c4033]">
              Kiểm tra lại kích cỡ, topping và số lượng trước khi chuyển sang bước báo giá &amp; thanh toán.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {hydrated && lines.length > 0 && (
              <button
                type="button"
                onClick={clear}
                className="rounded-full border border-[#e5b8b8] bg-white px-4 py-2 text-xs font-bold text-[#9b2c2c] transition hover:bg-[#fbeaea]"
              >
                Làm trống giỏ
              </button>
            )}
            <Link
              href="/menu"
              className="rounded-full bg-[#6d4c3d] px-5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-[#563a2d]"
            >
              + Chọn thêm đồ uống
            </Link>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-6 py-10 text-[#4a2e20]">
        {!hydrated ? (
          <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]" role="status">
            <p className="sr-only">Đang tải giỏ…</p>
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-32 animate-pulse rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-5"
                />
              ))}
            </div>
            <div className="h-64 animate-pulse rounded-2xl border border-[#decbb4] bg-white p-6" />
          </div>
        ) : lines.length === 0 ? (
          <section className="rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-12 text-center shadow-xs">
            <div className="mx-auto grid size-16 place-items-center rounded-full bg-[#cbe8d3] text-3xl shadow-2xs">
              ☕
            </div>
            <h2 className="mt-4 text-xl font-extrabold text-[#4a2e20]">Giỏ hàng đang trống.</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-[#7a6254]">
              Bạn chưa chọn món đồ uống nào. Hãy khám phá thực đơn BrewLite Mộc Vị để tùy chỉnh ly đồ uống yêu thích nhé!
            </p>
            <Link
              href="/menu"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#6d4c3d] px-7 py-3 text-xs font-bold text-white shadow-xs transition hover:bg-[#563a2d]"
            >
              <span>Khám phá thực đơn</span>
              <span aria-hidden="true">→</span>
            </Link>
          </section>
        ) : (
          <div className="grid items-start gap-8 lg:grid-cols-[1.55fr_1fr]">
            <div className="space-y-4">
              {lines.map((l) => {
                const unit = lineUnitPrice(l);
                const total = lineTotal(l);

                return (
                  <section
                    key={l.id}
                    className="flex flex-col gap-4 rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-4 shadow-xs transition hover:border-[#6d4c3d] sm:flex-row sm:items-center"
                  >
                    <Link
                      href={`/products/${l.productId}`}
                      className="relative size-22 shrink-0 overflow-hidden rounded-xl border border-white bg-white shadow-2xs"
                    >
                      <ProductImage src={l.imageUrl} alt={l.productName} className="size-full" />
                    </Link>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/products/${l.productId}`}
                          className="text-base font-extrabold text-[#4a2e20] hover:text-[#6d4c3d] hover:underline"
                        >
                          <h2>
                            {l.productName} · {l.size}
                          </h2>
                        </Link>
                        <span className="rounded-full bg-[#cbe8d3] px-2.5 py-0.5 text-xs font-bold text-[#2d6a4f]">
                          Size {l.size} ({formatVnd(l.sizePrice)})
                        </span>
                      </div>

                      <p className="text-xs text-[#7a6254]">
                        {l.toppings.length > 0
                          ? `Topping: ${l.toppings.map((t) => `${t.name} (+${formatVnd(t.price)})`).join(', ')}`
                          : 'Không topping'}
                      </p>

                      <p className="text-xs font-medium text-[#7a6254]">
                        Đơn giá: <span className="font-bold text-[#6d4c3d]">{formatVnd(unit)}</span> / ly
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#decbb4] pt-3 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                      <strong className="text-lg font-extrabold text-[#4a2e20]">
                        {formatVnd(total)}
                      </strong>

                      <div className="flex items-center gap-2">
                        <div className="flex h-9 items-center overflow-hidden rounded-full border border-[#6d4c3d] bg-white">
                          <button
                            type="button"
                            aria-label={`Giảm số lượng ${l.productName}`}
                            disabled={l.qty <= 1}
                            onClick={() => setQty(l.id, Math.max(1, l.qty - 1))}
                            className="h-full w-8 text-base font-bold text-[#4a2e20] transition hover:bg-[#efe5d4] disabled:opacity-40"
                          >
                            −
                          </button>
                          <input
                            aria-label={`Số lượng ${l.productName}`}
                            type="number"
                            min={1}
                            max={MAX_QTY}
                            value={l.qty}
                            onChange={(e) => {
                              const qty = Number(e.target.value);
                              if (Number.isInteger(qty) && qty >= 1 && qty <= MAX_QTY) {
                                setQty(l.id, qty);
                              }
                            }}
                            className="h-full w-10 border-x border-[#decbb4] bg-white text-center text-xs font-extrabold text-[#4a2e20] outline-none"
                          />
                          <button
                            type="button"
                            aria-label={`Tăng số lượng ${l.productName}`}
                            disabled={l.qty >= MAX_QTY}
                            onClick={() => setQty(l.id, Math.min(MAX_QTY, l.qty + 1))}
                            className="h-full w-8 text-base font-bold text-[#4a2e20] transition hover:bg-[#efe5d4] disabled:opacity-40"
                          >
                            +
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeItem(l.id)}
                          className="rounded-full border border-[#e5b8b8] bg-white px-3.5 py-1.5 text-xs font-bold text-[#9b2c2c] transition hover:bg-[#fbeaea]"
                        >
                          Xóa
                        </button>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>

            <aside className="rounded-2xl border border-[#decbb4] bg-white p-6 shadow-xs lg:sticky lg:top-28">
              <h2 className="text-lg font-extrabold text-[#4a2e20]">Tóm tắt giỏ hàng</h2>
              <p className="mt-1 text-xs text-[#7a6254]">
                Giá cuối cùng và mã khuyến mãi được xác nhận ở bước thanh toán.
              </p>

              <div className="my-5 space-y-3 border-y border-[#decbb4] py-4 text-sm">
                <div className="flex items-center justify-between text-[#7a6254]">
                  <span>Số dòng cấu hình</span>
                  <span className="font-bold text-[#4a2e20]">{lines.length} món</span>
                </div>
                <div className="flex items-center justify-between text-[#7a6254]">
                  <span>Tổng số lượng</span>
                  <span className="font-bold text-[#4a2e20]">{itemCount} ly</span>
                </div>
                <div className="flex items-center justify-between border-t border-dashed border-[#decbb4] pt-3 text-base">
                  <span className="font-extrabold text-[#4a2e20]">Tạm tính</span>
                  <strong className="text-xl font-extrabold text-[#6d4c3d]">
                    {formatVnd(subtotal)}
                  </strong>
                </div>
              </div>

              <div className="mb-5 flex items-center justify-between rounded-xl border border-[#b5dcc0] bg-[#cbe8d3]/65 px-3.5 py-2.5 text-xs text-[#2d6a4f]">
                <span className="font-bold">★ Điểm thưởng dự kiến</span>
                <strong>+{expectedPoints} điểm</strong>
              </div>

              <Link
                href="/checkout"
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[#6d4c3d] px-6 py-3.5 text-sm font-bold text-white shadow-xs transition hover:bg-[#563a2d]"
              >
                <span>Tiếp tục thanh toán</span>
                <span aria-hidden="true">→</span>
              </Link>

              <p className="mt-4 text-center text-xs text-[#7a6254]">
                <Link
                  href="/menu"
                  className="font-bold text-[#6d4c3d] underline underline-offset-4 hover:text-[#4a2e20]"
                >
                  Chọn thêm đồ uống
                </Link>
              </p>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
