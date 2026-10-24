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

/**
 * Snapshot một dòng giỏ tại thời điểm tạo đơn, dùng cho cleanup sau khi đơn PAID.
 * `id` BẮT BUỘC: là định danh của instance dòng (mỗi lần dòng được tạo mới sẽ có id mới),
 * nhờ đó món thêm lại sau khi xóa/clear không bị trừ nhầm.
 * Luôn lấy snapshot qua `useCartStore.getState().getSnapshot()` (hoặc `createSnapshot()`),
 * không tự dựng `{ key, qty }`.
 */
export type PurchasedLine = {
  id: string;
  key: string;
  qty: number;
};

export type RemovePurchasedResult = {
  /** Số mục snapshot đã khớp một dòng còn trong giỏ và được trừ. */
  applied: number;
  /** Số mục bị bỏ qua: thiếu id, qty không hợp lệ, hoặc dòng đã không còn trong giỏ. */
  skipped: number;
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
    assertQtyInLimit(l.qty);
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
  /**
   * Chỉ trừ các dòng đã mua sau khi GET order xác nhận PAID; dòng thêm sau đó vẫn giữ.
   * Chỉ đối chiếu theo `id` của dòng. Mục thiếu id bị bỏ qua an toàn (không trừ theo key).
   * KHÔNG gọi khi thanh toán thất bại hoặc chưa rõ kết quả (lỗi mạng, PENDING).
   */
  removePurchased: (purchased: readonly PurchasedLine[]) => RemovePurchasedResult;
  /**
   * Chụp snapshot giỏ (id + key + qty) tại thời điểm tạo đơn. Checkout lưu snapshot này
   * cùng orderId rồi chỉ đưa vào `removePurchased` SAU KHI GET order xác nhận PAID.
   */
  getSnapshot: () => PurchasedLine[];
  /** Đồng nghĩa với getSnapshot (giữ để tương thích). */
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

/** Số lượng gửi đi/ghi vào giỏ phải là số nguyên dương và không vượt MAX_QTY. */
export function assertQtyInLimit(qty: number): void {
  validateQty(qty);
  if (qty > MAX_QTY) {
    throw new Error(`Số lượng sản phẩm tối đa là ${MAX_QTY}.`);
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
        assertQtyInLimit(qty);
        const nextQty = qty;
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
      removePurchased: (purchased) => {
        const deductions = new Map<string, number>();
        let skipped = 0;
        for (const p of purchased) {
          const id = (p as { id?: unknown }).id;
          if (typeof id !== 'string' || id === '' || !Number.isInteger(p.qty) || p.qty <= 0) {
            skipped += 1; // thiếu id (snapshot cũ dạng { key, qty }) hoặc qty sai: bỏ qua, không đoán theo key
            continue;
          }
          deductions.set(id, (deductions.get(id) ?? 0) + p.qty);
        }

        const existingIds = new Set(get().lines.map((l) => l.id));
        let applied = 0;
        for (const id of deductions.keys()) {
          if (existingIds.has(id)) applied += 1;
          else skipped += 1; // dòng đã bị xóa/clear: không trừ vào dòng mới cùng cấu hình
        }

        if (applied > 0) {
          set((s) => ({
            lines: s.lines
              .map((l) => {
                const deduct = deductions.get(l.id);
                return deduct ? { ...l, qty: l.qty - deduct, version: (l.version ?? 1) + 1 } : l;
              })
              .filter((l) => l.qty > 0),
          }));
        }
        return { applied, skipped };
      },
      getSnapshot: () => get().lines.map((l) => ({ id: l.id, key: l.key, qty: l.qty })),
      createSnapshot: () => get().lines.map((l) => ({ id: l.id, key: l.key, qty: l.qty })),
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
      merge: (persisted, current) => {
        const raw = (persisted as { lines?: unknown } | undefined)?.lines;
        if (!Array.isArray(raw)) return current;
        const lines = raw
          .filter(
            (l): l is CartLine =>
              !!l &&
              typeof l.key === 'string' &&
              typeof l.productId === 'string' &&
              Number.isFinite(l.sizePrice) &&
              Array.isArray(l.toppings) &&
              Number.isInteger(l.qty) &&
              l.qty >= 1 &&
              l.qty <= MAX_QTY,
          )
          .slice(0, MAX_LINES)
          .map((l) => ({ ...l, id: typeof l.id === 'string' && l.id ? l.id : generateLineId() }));
        return { ...current, lines };
      },
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