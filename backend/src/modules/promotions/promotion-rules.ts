// Owner: TV1 — #14. Hàm thuần tính/kiểm tra khuyến mãi (business-rules §6).
export type PromotionRule = {
  type: 'FIXED' | 'PERCENT';
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  maxUses: number | null;
  usedCount: number;
  startsAt: Date;
  endsAt: Date;
  active: boolean;
};

export type PromotionEvaluation = { ok: true; discount: number } | { ok: false; reason: 'INVALID' | 'EXHAUSTED' };

export const normalizeCode = (code: string) => code.trim().toUpperCase();

export function calculateDiscount(rule: Pick<PromotionRule, 'type' | 'value' | 'maxDiscount'>, subtotal: number): number {
  if (rule.type === 'FIXED') return Math.min(rule.value, subtotal);
  let discount = Math.floor((subtotal * rule.value) / 100);
  if (rule.maxDiscount !== null) discount = Math.min(discount, rule.maxDiscount); // maxDiscount chỉ áp cho PERCENT
  return Math.min(discount, subtotal);
}

export function evaluatePromotion(rule: PromotionRule, subtotal: number, now: Date): PromotionEvaluation {
  const inWindow = rule.startsAt <= now && now < rule.endsAt;
  if (!rule.active || !inWindow || subtotal < rule.minSubtotal) return { ok: false, reason: 'INVALID' };
  if (rule.maxUses !== null && rule.usedCount >= rule.maxUses) return { ok: false, reason: 'EXHAUSTED' };
  return { ok: true, discount: calculateDiscount(rule, subtotal) };
}
