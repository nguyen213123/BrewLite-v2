'use client';

// Owner: TV1 — #3. Trang chi tiết: chọn size/topping/số lượng, giá tạm tính, thêm vào giỏ qua cart store (TV2).
import { useState } from 'react';
import Link from 'next/link';
import type { AddItemInput, AddItemResult } from '@/lib/cart/cart-store';
import type { ProductDetail, Size } from '@/lib/contracts/api.generated';
import { formatVnd } from './format';
import { maxQtyFor, priceSelection, toAddItemInput, validateSelection } from './pricing';

type Props = { product: ProductDetail; onAddToCart: (input: AddItemInput) => AddItemResult };
type Feedback = { kind: 'ok' | 'error'; text: string } | null;

const choice = (selected: boolean) =>
  `flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left transition ${
    selected
      ? 'border-[#6d4c3d] bg-[#cbe8d3]/55 text-[#4a2e20] shadow-[0_0_0_1px_#6d4c3d]'
      : 'border-[#decbb4] bg-[#faf6ec] text-[#4a2e20] hover:border-[#6d4c3d] hover:bg-white'
  }`;

export function ProductDetailView({ product, onAddToCart }: Props) {
  const [size, setSize] = useState<Size | null>(product.sizes[0]?.size ?? null);
  const [toppingIds, setToppingIds] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [imageOk, setImageOk] = useState(true);

  const selection = { size, toppingIds, qty };
  const currentSize = product.sizes.find((s) => s.size === size);
  const availableCups = currentSize ? currentSize.stock : product.stock;
  const soldOut = product.stock <= 0 || availableCups <= 0;
  const maxQty = Math.max(1, maxQtyFor(product, size, toppingIds));
  const priced = priceSelection(product, selection);
  const problem = validateSelection(product, selection);

  const touch = () => setFeedback(null);
  const toggleTopping = (id: string) => {
    touch();
    setToppingIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };

  function submit() {
    const input = toAddItemInput(product, selection);
    if (!input) {
      setFeedback({ kind: 'error', text: problem ?? 'Cấu hình không hợp lệ' });
      return;
    }
    const result = onAddToCart(input);
    setFeedback(
      result.ok
        ? { kind: 'ok', text: result.message ?? 'Đã thêm vào giỏ hàng.' }
        : { kind: 'error', text: result.message ?? 'Không thể thêm vào giỏ hàng.' },
    );
  }

  return (
    <div>
      {/* Dải tiêu đề nền Xanh Mint Pastel đồng bộ */}
      <div className="border-b border-[#b5dcc0] bg-[#cbe8d3]/75">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5 text-xs font-bold">
          <Link
            href="/menu"
            className="inline-flex items-center gap-1.5 text-[#4a2e20] transition hover:text-[#6d4c3d]"
          >
            ← Quay lại thực đơn
          </Link>
          <Link
            href="/cart"
            className="rounded-full bg-[#6d4c3d] px-4 py-1.5 text-white transition hover:bg-[#563a2d]"
          >
            Đi tới giỏ hàng →
          </Link>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-6 py-10 text-[#4a2e20]">
        <div className="grid gap-8 md:grid-cols-[0.95fr_1.05fr] lg:gap-10">
          {/* Khung ảnh màu kem cát (#efe5d4) chuẩn phong cách Mộc Vị */}
          <div className="rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-4 shadow-xs md:sticky md:top-28 md:self-start">
            <div className="relative aspect-square overflow-hidden rounded-xl bg-white shadow-2xs">
              {imageOk ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  onError={() => setImageOk(false)}
                  className="size-full object-cover"
                />
              ) : (
                <div
                  className="grid size-full place-items-center bg-[#cbe8d3]/40 text-7xl"
                  aria-hidden="true"
                >
                  ☕
                </div>
              )}
              <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                {soldOut ? (
                  <span className="rounded-full border border-[#e5b8b8] bg-[#fbeaea] px-3.5 py-1 text-xs font-bold text-[#9b2c2c] shadow-xs">
                    Hết hàng
                  </span>
                ) : (
                  <span className="rounded-full bg-[#6d4c3d] px-3.5 py-1 text-xs font-bold text-white shadow-xs">
                    Còn {availableCups} ly
                  </span>
                )}
              </div>
            </div>
            <p className="mt-3 text-center text-xs font-bold text-[#6d4c3d]">
              BrewLite Mộc Vị · Pha chế tươi mỗi ngày
            </p>
          </div>

          <section
            aria-label="Tùy chọn sản phẩm"
            className="rounded-2xl border border-[#decbb4] bg-white p-6 shadow-xs sm:p-8"
          >
            <p className="eyebrow">BrewLite Mộc Vị / Tùy chỉnh thức uống</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-[#4a2e20] sm:text-4xl">
              {product.name}
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-[#7a6254] sm:text-base">
              {product.description}
            </p>

            <div className="my-6 flex items-center justify-between rounded-xl border border-[#e2d2b8] bg-[#efe5d4] px-4 py-3.5">
              <span className="text-sm font-semibold text-[#6d4c3d]">Giá cơ bản (size S)</span>
              <strong className="text-lg font-extrabold text-[#4a2e20]">
                {formatVnd(product.price)}
              </strong>
            </div>

            <fieldset className="border-t border-[#decbb4]/80 py-5">
              <legend className="sr-only">Chọn kích cỡ</legend>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-extrabold text-[#4a2e20]">Chọn kích cỡ</h2>
                <span className="rounded-full bg-[#cbe8d3] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#2d6a4f]">
                  Bắt buộc
                </span>
              </div>
              {product.sizes.length === 0 ? (
                <p className="text-sm text-[#9b2c2c]">Sản phẩm chưa có kích cỡ để chọn.</p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {product.sizes.map((s) => (
                    <button
                      key={s.size}
                      type="button"
                      aria-pressed={size === s.size}
                      onClick={() => {
                        touch();
                        setSize(s.size);
                      }}
                      className={choice(size === s.size)}
                    >
                      <b className="text-sm">
                        Size {s.size}
                        {s.stock <= 0 ? ' (Hết)' : ''}
                      </b>
                      <span className="text-xs font-semibold text-[#6d4c3d]">
                        {formatVnd(s.price)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset className="border-t border-[#decbb4]/80 py-5">
              <legend className="sr-only">Thêm topping</legend>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-extrabold text-[#4a2e20]">Thêm topping</h2>
                <small className="text-xs text-[#7a6254]">Tùy chọn · có thể chọn nhiều</small>
              </div>
              {product.toppings.length === 0 ? (
                <p className="text-sm text-[#7a6254]">Món này không có topping.</p>
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {product.toppings.map((t) => {
                    const on = toppingIds.includes(t.id);
                    const isOutOfStock = t.stock <= 0;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        disabled={isOutOfStock}
                        onClick={() => toggleTopping(t.id)}
                        className={`${choice(on)} ${isOutOfStock ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        <span className="flex items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            className={`grid size-5 place-items-center rounded-md border text-xs font-bold transition ${
                              on
                                ? 'border-[#6d4c3d] bg-[#6d4c3d] text-white'
                                : 'border-[#decbb4] bg-white text-transparent'
                            }`}
                          >
                            ✓
                          </span>
                          <b className="text-sm">
                            {t.name}
                            {isOutOfStock ? ' (Hết)' : ''}
                          </b>
                        </span>
                        <span className="text-xs font-semibold text-[#6d4c3d]">
                          +{formatVnd(t.price)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </fieldset>

            <p className="flex items-center gap-2 border-t border-[#decbb4]/80 pt-4 text-xs text-[#7a6254]">
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${soldOut ? 'bg-[#9b2c2c]' : 'bg-[#2d6a4f]'}`}
              />
              {soldOut ? 'Hết hàng' : `Còn ${availableCups} ly`} · Giá cuối cùng do hệ thống xác nhận khi đặt đơn.
            </p>

            <div className="mt-5 flex flex-col gap-3 border-t border-[#decbb4]/80 pt-5 sm:flex-row">
              <div className="flex h-12 items-center justify-between overflow-hidden rounded-full border-2 border-[#6d4c3d] bg-[#faf6ec] px-1 sm:w-36">
                <button
                  type="button"
                  aria-label="Giảm số lượng"
                  disabled={qty <= 1}
                  onClick={() => {
                    touch();
                    setQty((q) => q - 1);
                  }}
                  className="h-9 w-9 rounded-full text-xl font-bold text-[#4a2e20] transition hover:bg-[#efe5d4] disabled:opacity-40"
                >
                  −
                </button>
                <output
                  aria-live="polite"
                  className="w-10 text-center text-base font-extrabold text-[#4a2e20]"
                >
                  {qty}
                </output>
                <button
                  type="button"
                  aria-label="Tăng số lượng"
                  disabled={qty >= maxQty}
                  onClick={() => {
                    touch();
                    setQty((q) => q + 1);
                  }}
                  className="h-9 w-9 rounded-full text-xl font-bold text-[#4a2e20] transition hover:bg-[#efe5d4] disabled:opacity-40"
                >
                  +
                </button>
              </div>

              <button
                type="button"
                onClick={submit}
                disabled={problem !== null}
                className="flex h-12 flex-1 items-center justify-between rounded-full bg-[#6d4c3d] px-6 text-sm font-bold text-white shadow-xs transition hover:bg-[#563a2d] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span>{soldOut ? 'Hết hàng' : 'Thêm vào giỏ hàng'}</span>
                <strong className="text-base">{priced ? formatVnd(priced.lineTotal) : '—'}</strong>
              </button>
            </div>

            {problem && !soldOut && (
              <p className="mt-3 text-sm font-medium text-[#9b2c2c]">{problem}</p>
            )}

            <div
              role={feedback?.kind === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              className="mt-3 min-h-6"
            >
              {feedback && (
                <div
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold ${
                    feedback.kind === 'error'
                      ? 'border-[#e5b8b8] bg-[#fbeaea] text-[#9b2c2c]'
                      : 'border-[#9ecfb0] bg-[#cbe8d3]/65 text-[#2d6a4f]'
                  }`}
                >
                  <span>{feedback.text}</span>
                  {feedback.kind === 'ok' && (
                    <Link
                      href="/cart"
                      className="rounded-full bg-[#6d4c3d] px-4 py-1.5 text-xs font-bold text-white transition hover:bg-[#563a2d]"
                    >
                      Xem giỏ hàng →
                    </Link>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
