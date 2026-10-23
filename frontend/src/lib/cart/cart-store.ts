'use client';

import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CartItem, Size } from '@/lib/contracts/api.generated';

// Giới hạn theo business-rules.md mục 2.3
export const MAX_QTY = 99;
export const MAX_LINES = 50;
export const MAX_TOPPINGS = 10;

export type CartTopping = { id: string; name: string; price: number };

/** Dòng giỏ hàng. Giá chỉ để hiển thị; server luôn tính lại (quote/order). */
export type CartLine = {
  key: string;
  productId: string;
  productName: string;
  imageUrl: string;
  size: Size;
  sizePrice: number;
  toppings: CartTopping[];
  qty: number;
};

export type AddItemInput = Omit<CartLine, 'key' | 'qty'> & { qty?: number };
export type AddItemResult = { ok: true; capped: boolean } | { ok: false; reason: 'MAX_LINES' | 'MAX_TOPPINGS' | 'INVALID' };
export type PurchasedLine = { key: string; qty: number };

/** Cùng sản phẩm + size + tập topping (sắp xếp theo ID) => cùng một dòng. */
export function lineKey(productId: string, size: Size, toppingIds: string[]): string {
  return [productId, size, ...[...toppingIds].sort()].join('|');
}

export function lineUnitPrice(line: CartLine): number {
  return line.sizePrice + line.toppings.reduce((sum, t) => sum + t.price, 0);
}
export function lineTotal(line: CartLine): number {
  return lineUnitPrice(line) * line.qty;
}
/** Badge = tổng qty. */
export function totalQty(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0);
}
/** Chỉ gửi các trường theo contract (CartItem): không giá, không userId. */
export function toCartItems(lines: CartLine[]): CartItem[] {
  return lines.map((l) => {
    validateQty(l.qty);
    const toppingIds = [...l.toppings.map((t) => t.id)].sort();
    return toppingIds.length > 0
      ? { productId: l.productId, size: l.size, toppingIds, qty: l.qty }
      : { productId: l.productId, size: l.size, qty: l.qty };
  });
}

type CartState = {
  lines: CartLine[];
  /** Hàm dùng chung: TV1 (trang chi tiết) và menu gọi để thêm vào giỏ. */
  addItem: (input: AddItemInput) => AddItemResult;
  setQty: (key: string, qty: number) => void;
  removeItem: (key: string) => void;
  /** Chỉ trừ các dòng đã mua sau khi đơn PAID; dòng thêm sau đó vẫn giữ. */
  removePurchased: (purchased: PurchasedLine[]) => void;
  clear: () => void;
};

export function validateQty(qty: number): void {
  if (typeof qty !== 'number' || !Number.isFinite(qty)) {
    throw new Error('Số lượng sản phẩm không hợp lệ.');
  }
  if (!Number.isInteger(qty)) {
    throw new Error('Số lượng sản phẩm không được là số thập phân.');
  }
  if (qty === 0) {
    throw new Error('Số lượng sản phẩm không được bằng 0.');
  }
  if (qty < 0) {
    throw new Error('Số lượng sản phẩm không được nhỏ hơn 0.');
  }
}

export const clampQty = (qty: number): number => {
  validateQty(qty);
  return Math.min(MAX_QTY, qty);
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      addItem: (input) => {
        const toppings = input.toppings.filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i);
        if (toppings.length > MAX_TOPPINGS) return { ok: false, reason: 'MAX_TOPPINGS' };
        const addQty = clampQty(input.qty ?? 1);
        if (!input.productId || !Number.isFinite(addQty)) return { ok: false, reason: 'INVALID' };

        const key = lineKey(input.productId, input.size, toppings.map((t) => t.id));
        const { lines } = get();
        const existing = lines.find((l) => l.key === key);
        if (existing) {
          const merged = existing.qty + addQty;
          set({ lines: lines.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_QTY, merged) } : l)) });
          return { ok: true, capped: merged > MAX_QTY };
        }
        if (lines.length >= MAX_LINES) return { ok: false, reason: 'MAX_LINES' };
        set({ lines: [...lines, { ...input, toppings, key, qty: addQty }] });
        return { ok: true, capped: false };
      },
      setQty: (key, qty) => {
        const nextQty = clampQty(qty);
        set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, qty: nextQty } : l)) }));
      },
      removeItem: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),
      removePurchased: (purchased) =>
        set((s) => ({
          lines: s.lines
            .map((l) => {
              const bought = purchased.find((p) => p.key === l.key);
              return bought ? { ...l, qty: l.qty - bought.qty } : l;
            })
            .filter((l) => l.qty > 0),
        })),
      clear: () => set({ lines: [] }),
    }),
    {
      name: 'brewlite-cart',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ lines: s.lines }),
    },
  ),
);

/** Tránh lệch SSR/client: chỉ hiển thị dữ liệu giỏ sau khi đã hydrate từ localStorage. */
export function useCartHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => useCartStore.persist.onFinishHydration(onChange),
    () => useCartStore.persist.hasHydrated(),
    () => false,
  );
}
