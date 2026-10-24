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
  id: string;
  key: string;
  productId: string;
  productName: string;
  imageUrl: string;
  size: Size;
  sizePrice: number;
  toppings: CartTopping[];
  qty: number;
  version?: number;
};

export type AddItemInput = Omit<CartLine, 'key' | 'qty' | 'id'> & {
  qty?: number;
  id?: string;
};

export type AddItemResult =
  | { ok: true; capped: boolean; message?: string }
  | { ok: false; reason: 'MAX_LINES' | 'MAX_TOPPINGS' | 'INVALID'; message?: string };

export type PurchasedLine = {
  key: string;
  qty: number;
  id?: string;
  lineId?: string;
};

/** Cùng sản phẩm + size + tập topping (sắp xếp theo ID) => cùng một dòng. */
export function lineKey(productId: string, size: Size, toppingIds: string[]): string {
  return [productId, size, ...[...toppingIds].sort()].join('|');
}

export function generateLineId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `line_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
  setQty: (keyOrId: string, qty: number) => void;
  removeItem: (keyOrId: string) => void;
  /** Chỉ trừ các dòng đã mua sau khi đơn PAID; dòng thêm sau đó vẫn giữ. */
  removePurchased: (purchased: (PurchasedLine | CartLine)[]) => void;
  /** Lấy snapshot giỏ hàng kèm định danh id để phục vụ thanh toán an toàn. */
  getSnapshot: () => PurchasedLine[];
  createSnapshot: () => PurchasedLine[];
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
        const toppings = (input.toppings ?? []).filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i);
        if (toppings.length > MAX_TOPPINGS) {
          return { ok: false, reason: 'MAX_TOPPINGS', message: `Mỗi món tối đa ${MAX_TOPPINGS} topping.` };
        }
        const rawQty = input.qty ?? 1;
        try {
          validateQty(rawQty);
        } catch {
          return { ok: false, reason: 'INVALID', message: 'Số lượng không hợp lệ.' };
        }
        if (!input.productId) {
          return { ok: false, reason: 'INVALID', message: 'Thiếu mã sản phẩm.' };
        }

        const key = lineKey(input.productId, input.size, toppings.map((t) => t.id));
        const { lines } = get();
        const existing = lines.find((l) => l.key === key);

        if (existing) {
          const merged = existing.qty + rawQty;
          const capped = merged > MAX_QTY;
          const finalQty = Math.min(MAX_QTY, merged);
          set({
            lines: lines.map((l) =>
              l.key === key
                ? {
                    ...l,
                    qty: finalQty,
                    version: (l.version ?? 1) + 1,
                  }
                : l,
            ),
          });
          return {
            ok: true,
            capped,
            message: capped ? `Số lượng đã được giới hạn tối đa ${MAX_QTY} ly.` : undefined,
          };
        }

        if (lines.length >= MAX_LINES) {
          return { ok: false, reason: 'MAX_LINES', message: `Giỏ hàng tối đa ${MAX_LINES} dòng sản phẩm.` };
        }

        const capped = rawQty > MAX_QTY;
        const finalQty = Math.min(MAX_QTY, rawQty);
        const lineId = input.id || generateLineId();

        set({
          lines: [
            ...lines,
            {
              ...input,
              id: lineId,
              key,
              toppings,
              qty: finalQty,
              version: 1,
            },
          ],
        });

        return {
          ok: true,
          capped,
          message: capped ? `Số lượng đã được giới hạn tối đa ${MAX_QTY} ly.` : undefined,
        };
      },
      setQty: (keyOrId, qty) => {
        const nextQty = clampQty(qty);
        set((s) => ({
          lines: s.lines.map((l) =>
            l.key === keyOrId || l.id === keyOrId ? { ...l, qty: nextQty } : l,
          ),
        }));
      },
      removeItem: (keyOrId) =>
        set((s) => ({
          lines: s.lines.filter((l) => l.key !== keyOrId && l.id !== keyOrId),
        })),
      removePurchased: (purchased) =>
        set((s) => {
          const deductions = new Map<string, number>();
          for (const p of purchased) {
            const targetId = 'id' in p && p.id ? p.id : 'lineId' in p && p.lineId ? p.lineId : undefined;
            const lookupKey = targetId ? `id:${targetId}` : `key:${p.key}`;
            deductions.set(lookupKey, (deductions.get(lookupKey) ?? 0) + p.qty);
          }

          return {
            lines: s.lines
              .map((l) => {
                const deductById = deductions.get(`id:${l.id}`);
                const deductByKey = deductions.get(`key:${l.key}`);
                const deductQty =
                  deductById !== undefined ? deductById : deductByKey !== undefined ? deductByKey : 0;
                return deductQty > 0 ? { ...l, qty: l.qty - deductQty } : l;
              })
              .filter((l) => l.qty > 0),
          };
        }),
      getSnapshot: () =>
        get().lines.map((l) => ({
          id: l.id,
          lineId: l.id,
          key: l.key,
          qty: l.qty,
        })),
      createSnapshot: () =>
        get().lines.map((l) => ({
          id: l.id,
          lineId: l.id,
          key: l.key,
          qty: l.qty,
        })),
      clear: () => set({ lines: [] }),
    }),
    {
      name: 'brewlite-cart',
      version: 2,
      storage: createJSONStorage(() => {
        if (typeof window !== 'undefined' && window.localStorage) {
          return window.localStorage;
        }
        const memoryMap = new Map<string, string>();
        return {
          getItem: (key: string) => memoryMap.get(key) ?? null,
          setItem: (key: string, val: string) => {
            memoryMap.set(key, val);
          },
          removeItem: (key: string) => {
            memoryMap.delete(key);
          },
        };
      }),
      partialize: (s) => ({ lines: s.lines }),
      migrate: (persistedState: unknown) => {
        const state = persistedState as { lines?: Partial<CartLine>[] };
        if (state?.lines && Array.isArray(state.lines)) {
          return {
            lines: state.lines.map((l) => ({
              ...l,
              id: l.id || generateLineId(),
            })),
          };
        }
        return state;
      },
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
