'use client';

// Owner: TV1 — #3. Trang chi tiết: chọn size/topping/số lượng, giá tạm tính, thêm vào giỏ qua cart store (TV2).
import { useState } from 'react';
import Link from 'next/link';
import type { AddItemInput, AddItemResult } from '@/lib/cart/cart-store';
import type { ProductDetail, Size } from '@/lib/contracts/api.generated';
import { formatVnd } from './format';
import { MAX_QTY_PER_LINE, priceSelection, toAddItemInput, validateSelection } from './pricing';

type Props = { product: ProductDetail; onAddToCart: (input: AddItemInput) => AddItemResult };
type Feedback = { kind: 'ok' | 'error'; text: string } | null;

const choice = (selected: boolean) =>
  `flex items-center justify-between gap-2 rounded-md border px-4 py-3 text-left transition ${selected ? 'border-[#3FA7C9] bg-[#F0F9FC] shadow-[0_0_0_1px_#3FA7C9]' : 'border-[#D2E6EC] bg-white hover:border-[#3FA7C9]'}`;

export function ProductDetailView({ product, onAddToCart }: Props) {
  const [size, setSize] = useState<Size | null>(product.sizes[0]?.size ?? null);
  const [toppingIds, setToppingIds] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [imageOk, setImageOk] = useState(true);

  const selection = { size, toppingIds, qty };
  const soldOut = product.stock <= 0;
  const maxQty = Math.max(1, Math.min(MAX_QTY_PER_LINE, product.stock));
  const priced = priceSelection(product, selection);
  const problem = validateSelection(product, selection);

  const touch = () => setFeedback(null);
  const toggleTopping = (id: string) => {
    touch();
    setToppingIds(current => (current.includes(id) ? current.filter(x => x !== id) : [...current, id]));
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
    <main className="mx-auto max-w-6xl px-6 pb-24 pt-8 text-[#12303B]">
      <Link href="/menu" className="text-sm font-semibold text-[#4C8FA8] hover:text-[#1E6A86]">‹ &nbsp;Quay lại thực đơn</Link>

      <div className="mt-8 grid gap-10 md:grid-cols-[0.9fr_1.1fr] md:gap-16">
        <div className="relative h-80 overflow-hidden rounded-lg bg-[#E3F1F5] md:sticky md:top-24 md:h-[600px]">
          {imageOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.imageUrl} alt={product.name} onError={() => setImageOk(false)} className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center text-7xl" aria-hidden="true">☕</div>
          )}
          {soldOut && <span className="absolute left-4 top-4 rounded bg-white px-3 py-2 text-sm font-bold text-[#C0392B]">Hết hàng</span>}
        </div>

        <section aria-label="Tùy chọn sản phẩm">
          <p className="text-[10px] font-extrabold tracking-[0.25em] text-[#3FA7C9]">TÙY CHỈNH THỨC UỐNG</p>
          <h1 className="mt-2 font-serif text-4xl font-medium text-[#1E6A86]">{product.name}</h1>
          <p className="mt-3 leading-7 text-[#6A8792]">{product.description}</p>

          <div className="my-6 flex items-center justify-between rounded-md bg-[#E3F1F5] px-4 py-3">
            <span className="text-[#6A8792]">Giá cơ bản (size S)</span>
            <strong className="text-lg text-[#1E6A86]">{formatVnd(product.price)}</strong>
          </div>

          <fieldset className="border-t border-[#D2E6EC] py-6">
            <legend className="sr-only">Chọn kích cỡ</legend>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="font-semibold">Chọn kích cỡ</h2>
              <span className="rounded bg-[#D9EEF5] px-1.5 py-1 text-[9px] font-bold uppercase text-[#3FA7C9]">Bắt buộc</span>
            </div>
            {product.sizes.length === 0 ? (
              <p className="text-sm text-[#C0392B]">Sản phẩm chưa có kích cỡ để chọn.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {product.sizes.map(s => (
                  <button key={s.size} type="button" aria-pressed={size === s.size} onClick={() => { touch(); setSize(s.size); }} className={choice(size === s.size)}>
                    <b>{s.size}</b>
                    <span className="text-xs text-[#6A8792]">{formatVnd(s.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="border-t border-[#D2E6EC] py-6">
            <legend className="sr-only">Thêm topping</legend>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="font-semibold">Thêm topping</h2>
              <small className="text-[#6A8792]">Tùy chọn · có thể chọn nhiều</small>
            </div>
            {product.toppings.length === 0 ? (
              <p className="text-sm text-[#6A8792]">Món này không có topping.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {product.toppings.map(t => {
                  const on = toppingIds.includes(t.id);
                  return (
                    <button key={t.id} type="button" aria-pressed={on} onClick={() => toggleTopping(t.id)} className={choice(on)}>
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className={`grid size-5 place-items-center rounded border text-xs ${on ? 'border-[#3FA7C9] bg-[#3FA7C9] text-white' : 'border-[#D2E6EC] text-transparent'}`}>✓</span>
                        <b className="text-sm">{t.name}</b>
                      </span>
                      <span className="text-xs text-[#6A8792]">+{formatVnd(t.price)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>

          <p className="flex items-center gap-2 border-t border-[#D2E6EC] pt-4 text-xs text-[#6A8792]">
            <span aria-hidden="true" className={`size-2 rounded-full ${soldOut ? 'bg-[#B66148]' : 'bg-[#708C54]'}`} />
            {soldOut ? 'Hết hàng' : `Còn ${product.stock} ly`} · Giá cuối cùng do hệ thống xác nhận khi đặt đơn.
          </p>

          <div className="sticky bottom-0 mt-4 flex gap-3 border-t border-[#D2E6EC] bg-[#F2F9FB]/95 py-4 backdrop-blur">
            <div className="flex h-12 items-center overflow-hidden rounded-md border border-[#D2E6EC] bg-white">
              <button type="button" aria-label="Giảm số lượng" disabled={qty <= 1} onClick={() => { touch(); setQty(q => q - 1); }} className="h-full w-11 text-xl text-[#4C8FA8] disabled:opacity-40">−</button>
              <output aria-live="polite" className="w-8 text-center font-bold">{qty}</output>
              <button type="button" aria-label="Tăng số lượng" disabled={qty >= maxQty} onClick={() => { touch(); setQty(q => q + 1); }} className="h-full w-11 text-xl text-[#4C8FA8] disabled:opacity-40">+</button>
            </div>
            <button type="button" onClick={submit} disabled={problem !== null} className="flex h-12 flex-1 items-center justify-between rounded-md bg-[#1E6A86] px-5 font-bold text-white transition hover:bg-[#2A7F9F] disabled:cursor-not-allowed disabled:bg-[#9db6bf] focus-visible:outline-2 focus-visible:outline-offset-2">
              <span>{soldOut ? 'Hết hàng' : 'Thêm vào giỏ hàng'}</span>
              <strong>{priced ? formatVnd(priced.lineTotal) : '—'}</strong>
            </button>
          </div>

          {problem && !soldOut && <p className="text-sm text-[#C0392B]">{problem}</p>}
          <p
            role={feedback?.kind === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`min-h-5 text-sm ${feedback?.kind === 'error' ? 'text-[#C0392B]' : 'text-[#2E8B57]'}`}
          >
            {feedback?.text ?? ''}
            {feedback?.kind === 'ok' && <> <Link href="/cart" className="font-semibold underline underline-offset-4">Xem giỏ hàng</Link></>}
          </p>
        </section>
      </div>
    </main>
  );
}