import { CatalogPricingService } from '../src/modules/products/catalog-pricing.service';
import { PromotionsService } from '../src/modules/promotions/promotions.service';
import type { Tx } from '../src/common/contracts/ports';

describe('Shared catalog pricing and promotion validation', () => {
  const product = { id: 'p1', name: 'Cappuccino', sizes: [{ size: 'M', price: 50000 }],
    toppings: [{ topping: { id: 't1', name: 'Kem', price: 10000, active: true } },
      { topping: { id: 'inactive', name: 'Old', price: 1, active: false } }] };
  function setup() {
    const tx = { product: { findMany: jest.fn().mockResolvedValue([product]) } };
    const catalog = new CatalogPricingService();
    return { tx, catalog, transaction: tx as unknown as Tx };
  }
  it('prices the requested size and active toppings using the supplied transaction', async () => {
    const h = setup();
    const [line] = await h.catalog.resolve(h.transaction, [{ productId: 'p1', size: 'M', toppingIds: ['t1'], qty: 2 }]);
    expect(line).toMatchObject({ sizePrice: 50000, unitPrice: 60000, lineTotal: 120000 });
    expect(h.tx.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['p1'] }, active: true } }));
  });
  it('rejects missing/inactive products, unavailable sizes and disallowed/inactive toppings', async () => {
    const h = setup();
    for (const item of [
      { productId: 'p1', size: 'S' as const, qty: 1 },
      { productId: 'p1', size: 'M' as const, toppingIds: ['inactive'], qty: 1 },
      { productId: 'p1', size: 'M' as const, toppingIds: ['other'], qty: 1 },
    ]) await expect(h.catalog.resolve(h.transaction, [item])).rejects.toMatchObject({ response: { code: 'INVALID_SELECTION' } });
    h.tx.product.findMany.mockResolvedValueOnce([]);
    await expect(h.catalog.resolve(h.transaction, [{ productId: 'p1', size: 'M', qty: 1 }])).rejects.toMatchObject({ response: { code: 'PRODUCT_NOT_FOUND' } });
  });
  it('promotion validate rejects duplicate configurations whose merged quantity exceeds 99', async () => {
    const h = setup();
    const service = new PromotionsService(h.catalog, { run: async (work: (tx: Tx) => unknown) => work(h.transaction) } as never);
    await expect(service.validate('u1', { code: 'SAVE10', items: [
      { productId: 'p1', size: 'M', qty: 60 }, { productId: 'p1', size: 'M', qty: 60 },
    ] })).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(h.tx.product.findMany).not.toHaveBeenCalled();
  });
  it('promotion validate rejects a subtotal above 2 billion before applying a promotion', async () => {
    const resolve = jest.fn().mockResolvedValue([{ productId: 'p', productName: 'x', size: 'M', sizePrice: 1_000_000_000,
      toppings: [], qty: 3, unitPrice: 1, lineTotal: 1 }]);
    const service = new PromotionsService({ resolve }, { run: async (work: (tx: Tx) => unknown) => work({} as Tx) } as never);
    await expect(service.validate('u', { code: 'SAVE10', items: [{ productId: 'p', size: 'M', qty: 3 }] }))
      .rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });
});
