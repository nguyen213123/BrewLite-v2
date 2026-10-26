// Issue #14 — Khuyến mãi: quy tắc giảm giá, validate, giữ/trả lượt dùng mã.
// Phần 1 và 2 luôn chạy. Phần 3 chạy với RUN_DB_TESTS=1 và DATABASE_URL đã migrate (giống CI).
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { UnitOfWork } from '../src/common/database/unit-of-work';
import type { CatalogPricingPort, Tx } from '../src/common/contracts/ports';
import { PromotionsService } from '../src/modules/promotions/promotions.service';
import { calculateDiscount, evaluatePromotion, normalizeCode, PromotionRule } from '../src/modules/promotions/promotion-rules';

const now = new Date('2026-10-23T00:00:00Z');
const base: PromotionRule = {
  type: 'PERCENT', value: 10, minSubtotal: 100000, maxDiscount: 30000, maxUses: 100, usedCount: 0,
  startsAt: new Date('2026-01-01T00:00:00Z'), endsAt: new Date('2030-01-01T00:00:00Z'), active: true,
};

describe('Issue #14 — Quy tắc khuyến mãi (hàm thuần)', () => {
  it('SAVE10 trên subtotal 120000 giảm 12000 (business-rules §8)', () => {
    expect(evaluatePromotion(base, 120000, now)).toEqual({ ok: true, discount: 12000 });
  });
  it('PERCENT bị giới hạn bởi maxDiscount', () => {
    expect(calculateDiscount(base, 500000)).toBe(30000);
  });
  it('PERCENT làm tròn xuống', () => {
    expect(calculateDiscount({ type: 'PERCENT', value: 10, maxDiscount: null }, 99999)).toBe(9999);
  });
  it('FIXED không vượt subtotal và bỏ qua maxDiscount', () => {
    expect(calculateDiscount({ type: 'FIXED', value: 20000, maxDiscount: 5 }, 15000)).toBe(15000);
    expect(calculateDiscount({ type: 'FIXED', value: 20000, maxDiscount: 5 }, 90000)).toBe(20000);
  });
  it('từ chối INVALID khi dưới minSubtotal, mã tắt, ngoài thời gian hiệu lực', () => {
    expect(evaluatePromotion(base, 99999, now)).toEqual({ ok: false, reason: 'INVALID' });
    expect(evaluatePromotion({ ...base, active: false }, 120000, now)).toEqual({ ok: false, reason: 'INVALID' });
    expect(evaluatePromotion({ ...base, endsAt: now }, 120000, now)).toEqual({ ok: false, reason: 'INVALID' }); // endsAt loại trừ
    expect(evaluatePromotion({ ...base, startsAt: new Date('2027-01-01T00:00:00Z') }, 120000, now)).toEqual({ ok: false, reason: 'INVALID' });
  });
  it('báo EXHAUSTED khi usedCount chạm maxUses; maxUses=null là không giới hạn', () => {
    expect(evaluatePromotion({ ...base, maxUses: 5, usedCount: 5 }, 120000, now)).toEqual({ ok: false, reason: 'EXHAUSTED' });
    expect(evaluatePromotion({ ...base, maxUses: null, usedCount: 9999 }, 120000, now).ok).toBe(true);
  });
  it('chuẩn hóa mã: bỏ khoảng trắng và viết hoa', () => {
    expect(normalizeCode('  save10 ')).toBe('SAVE10');
  });
});

describe('Issue #14 — PromotionsService.price (Tx giả, không cần DB)', () => {
  const rule = { id: randomUUID(), code: 'SAVE10', ...base, startsAt: new Date('2020-01-01T00:00:00Z'), endsAt: new Date('2099-01-01T00:00:00Z'), version: 0 };
  const service = new PromotionsService({ resolve: async () => [] } as unknown as CatalogPricingPort, {} as unknown as UnitOfWork);
  const txWith = (found: unknown) => ({ promotion: { findUnique: async () => found } }) as unknown as Tx;

  it('không có mã thì giảm 0 và không gắn khuyến mãi', async () => {
    expect(await service.price(txWith(null), undefined, 120000)).toEqual({ promotionId: null, promotionCode: null, discount: 0 });
  });
  it('mã hợp lệ trả snapshot gồm id, code và số tiền giảm', async () => {
    expect(await service.price(txWith(rule), 'save10', 120000)).toEqual({ promotionId: rule.id, promotionCode: 'SAVE10', discount: 12000 });
  });
  it('mã không tồn tại là 422 PROMOTION_INVALID', async () => {
    await expect(service.price(txWith(null), 'KHONGCO', 120000)).rejects.toMatchObject({ response: { code: 'PROMOTION_INVALID' } });
  });
  it('mã hết hạn là 422 PROMOTION_INVALID (ví dụ OLD10)', async () => {
    const expired = { ...rule, code: 'OLD10', endsAt: new Date('2020-02-01T00:00:00Z') };
    await expect(service.price(txWith(expired), 'OLD10', 120000)).rejects.toMatchObject({ response: { code: 'PROMOTION_INVALID' } });
  });
  it('mã hết lượt là 409 PROMOTION_EXHAUSTED', async () => {
    await expect(service.price(txWith({ ...rule, maxUses: 1, usedCount: 1 }), 'SAVE10', 120000)).rejects.toMatchObject({ response: { code: 'PROMOTION_EXHAUSTED' } });
  });
  it('listActive trả danh sách mã còn lượt từ bảng Promotion trong DB', async () => {
    const activeRule = { ...rule, code: 'GIAM20K', type: 'FIXED' as const, value: 20000, minSubtotal: 80000, maxDiscount: null, maxUses: null, usedCount: 0 };
    const exhaustedRule = { ...rule, code: 'HETLUOT', maxUses: 5, usedCount: 5 };
    const svc = new PromotionsService(
      { resolve: async () => [] } as unknown as CatalogPricingPort,
      { run: (fn: (tx: Tx) => unknown) => fn({ promotion: { findMany: async () => [activeRule, rule, exhaustedRule] } } as unknown as Tx) } as unknown as UnitOfWork,
    );
    const list = await (svc as unknown as { listActive: () => Promise<Array<{ code: string }>> }).listActive();
    expect(list.map(p => p.code)).toEqual(['GIAM20K', 'SAVE10']);
  });
});

describe('Issue #14 — validate: giới hạn tiền và gộp dòng trùng (Tx giả)', () => {
  const rule = { id: randomUUID(), code: 'SAVE10', ...base, startsAt: new Date('2020-01-01T00:00:00Z'), endsAt: new Date('2099-01-01T00:00:00Z'), version: 0 };
  const uow = { run: (fn: (tx: Tx) => unknown) => fn({ promotion: { findUnique: async () => rule } } as unknown as Tx) } as unknown as UnitOfWork;
  const pid = randomUUID();
  const t1 = randomUUID();
  const t2 = randomUUID();

  const makeService = (lineTotals: number[]) => {
  // mỗi dòng: sizePrice = lineTotal, qty = 1, không topping → lineTotal sau priceLine = đúng giá trị truyền vào
  const resolve = jest.fn(async () =>
    lineTotals.map(total => ({
      productId: pid, productName: 'Test', size: 'M', sizePrice: total, toppings: [], qty: 1, unitPrice: total, lineTotal: total,
    })),
  );
  const service = new PromotionsService({ resolve } as unknown as CatalogPricingPort, uow);
  return { service, resolve };
};
  const validationError = { response: { code: 'VALIDATION_ERROR' }, status: 400 };

  it('subtotal đúng 2.000.000.000 được chấp nhận', async () => {
    const { service } = makeService([1_000_000_000, 1_000_000_000]);
    const res = await service.validate(randomUUID(), { code: 'SAVE10', items: [{ productId: pid, size: 'M', qty: 1 }] } as never);
    expect(res.subtotal).toBe(2_000_000_000);
  });
  it('subtotal vượt biên (3 dòng x 1 tỷ, hoặc 2 tỷ + 1) là 400 VALIDATION_ERROR', async () => {
    for (const lines of [[1_000_000_000, 1_000_000_000, 1_000_000_000], [2_000_000_000, 1]]) {
      const { service } = makeService(lines);
      await expect(service.validate(randomUUID(), { code: 'SAVE10', items: [{ productId: pid, size: 'M', qty: 1 }] } as never))
        .rejects.toMatchObject(validationError);
    }
  });
  it('2 dòng trùng cấu hình (topping khác thứ tự) mỗi dòng 60 ly: gộp 120 > 99 → 400, không gọi catalog', async () => {
    const { service, resolve } = makeService([1]);
    const items = [
      { productId: pid, size: 'M', qty: 60, toppingIds: [t1, t2] },
      { productId: pid, size: 'M', qty: 60, toppingIds: [t2, t1] },
    ];
    await expect(service.validate(randomUUID(), { code: 'SAVE10', items } as never)).rejects.toMatchObject(validationError);
    expect(resolve).not.toHaveBeenCalled();
  });
  it('gộp đúng 99 ly là hợp lệ và catalog nhận 1 dòng đã gộp', async () => {
    const { service, resolve } = makeService([120000]);
    const items = [
      { productId: pid, size: 'M', qty: 50, toppingIds: [t1, t2] },
      { productId: pid, size: 'M', qty: 49, toppingIds: [t2, t1] },
    ];
    await service.validate(randomUUID(), { code: 'SAVE10', items } as never);
    expect(resolve).toHaveBeenCalledTimes(1);
    const passed = (resolve.mock.calls[0] as unknown[])[1] as { qty: number }[];
    expect(passed).toHaveLength(1);
    expect(passed[0].qty).toBe(99);
  });
  it('khác size hoặc khác tập topping thì KHÔNG gộp', async () => {
    const { service, resolve } = makeService([120000]);
    const items = [
      { productId: pid, size: 'M', qty: 60, toppingIds: [t1] },
      { productId: pid, size: 'L', qty: 60, toppingIds: [t1] },
      { productId: pid, size: 'M', qty: 60, toppingIds: [t1, t2] },
    ];
    await service.validate(randomUUID(), { code: 'SAVE10', items } as never);
    const passed = (resolve.mock.calls[0] as unknown[])[1] as { qty: number }[];
    expect(passed).toHaveLength(3);
    expect(passed.every(i => i.qty === 60)).toBe(true);
  });
  it('validate trả cùng subtotal/total với buildQuote', async () => {
     const { service } = makeService([30000, 90000]);
     const res = await service.validate(randomUUID(), { code: 'SAVE10', items: [{ productId: pid, size: 'M', qty: 1 }] } as never);
     expect(res.subtotal).toBe(120000);
     expect(res.discount).toBe(12000);
     expect(res.total).toBe(108000);
   });
});

const dbDescribe = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
dbDescribe('Issue #14 — Khuyến mãi trên PostgreSQL', () => {
  let prisma: PrismaService;
  let unitOfWork: UnitOfWork;
  let promotions: PromotionsService;
  const created: string[] = [];
  const window = { startsAt: new Date('2026-01-01'), endsAt: new Date('2030-01-01') };
  const makePromo = async (data: Record<string, unknown>) => {
    const promo = await prisma.promotion.create({ data: { code: `T${randomUUID().slice(0, 8).toUpperCase()}`, type: 'FIXED', value: 1000, ...window, ...data } as never });
    created.push(promo.id);
    return promo;
  };

  // Giỏ giả lập: Cappuccino M + Kem x2 = 120000 (tách khỏi module sản phẩm để #14 độc lập với #2, #3).
  const catalog = {
    resolve: async () => [{
      productId: randomUUID(), productName: 'Test', size: 'M', sizePrice: 50000,
      toppings: [{ id: randomUUID(), name: 'Kem', price: 10000 }], qty: 2, unitPrice: 60000, lineTotal: 120000,
    }],
  } as unknown as CatalogPricingPort;
  const cart = [{ productId: randomUUID(), size: 'M' as const, qty: 2 }];

  beforeAll(() => {
    prisma = new PrismaService();
    unitOfWork = new UnitOfWork(prisma);
    promotions = new PromotionsService(catalog, unitOfWork);
  });

  afterAll(async () => {
    await prisma.promotion.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });

  it('validate áp mã PERCENT có trần và làm tròn xuống', async () => {
    const promo = await makePromo({ type: 'PERCENT', value: 10, minSubtotal: 100000, maxDiscount: 30000 });
    const result = await promotions.validate(randomUUID(), { code: promo.code, items: cart });
    expect(result).toEqual({ code: promo.code, subtotal: 120000, discount: 12000, total: 108000, currency: 'VND' });
  });
  it('validate từ chối mã không tồn tại và đơn dưới mức tối thiểu bằng 422 PROMOTION_INVALID', async () => {
    await expect(promotions.validate(randomUUID(), { code: 'KHONGCO999', items: cart })).rejects.toMatchObject({ response: { code: 'PROMOTION_INVALID' } });
    const promo = await makePromo({ minSubtotal: 500000 });
    await expect(promotions.validate(randomUUID(), { code: promo.code, items: cart })).rejects.toMatchObject({ response: { code: 'PROMOTION_INVALID' } });
  });
  it('validate báo 409 PROMOTION_EXHAUSTED khi usedCount đã chạm maxUses', async () => {
    const promo = await makePromo({ maxUses: 1, usedCount: 1 });
    await expect(promotions.validate(randomUUID(), { code: promo.code, items: cart })).rejects.toMatchObject({ response: { code: 'PROMOTION_EXHAUSTED' } });
  });
  it('validate không giữ lượt: usedCount không đổi', async () => {
    const promo = await makePromo({ maxUses: 5 });
    await promotions.validate(randomUUID(), { code: promo.code, items: cart });
    expect((await prisma.promotion.findUniqueOrThrow({ where: { id: promo.id } })).usedCount).toBe(0);
  });
  it('maxUses=1 với 10 yêu cầu giữ lượt đồng thời: chỉ đúng 1 thành công (Task 10)', async () => {
    const promo = await makePromo({ maxUses: 1 });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => unitOfWork.run(tx => promotions.reserve(tx, promo.id))));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected').every(r => (r as PromiseRejectedResult).reason?.response?.code === 'PROMOTION_EXHAUSTED')).toBe(true);
    expect((await prisma.promotion.findUniqueOrThrow({ where: { id: promo.id } })).usedCount).toBe(1);
  });
  it('release trả đúng 1 lượt và không bao giờ xuống dưới 0', async () => {
    const promo = await makePromo({ maxUses: 2, usedCount: 1 });
    await unitOfWork.run(tx => promotions.release(tx, promo.id));
    expect((await prisma.promotion.findUniqueOrThrow({ where: { id: promo.id } })).usedCount).toBe(0);
    await expect(unitOfWork.run(tx => promotions.release(tx, promo.id))).rejects.toThrow();
  });
});