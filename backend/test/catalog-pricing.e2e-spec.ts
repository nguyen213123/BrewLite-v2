import { CatalogPricingService } from '../src/modules/products/catalog-pricing.service';
import { ProductsService } from '../src/modules/products/products.service';
import { PromotionsService } from '../src/modules/promotions/promotions.service';
import type { PrismaService } from '../src/prisma/prisma.service';
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

describe('ProductsService (tính số ly tồn kho theo công thức và nguyên liệu)', () => {
  const ING_COFFEE = '33333333-3333-4333-8333-333333333301';
  const ING_CONDENSED_MILK = '33333333-3333-4333-8333-333333333303';
  const ING_CREAM = '33333333-3333-4333-8333-333333333316';
  const ING_PEARL = '33333333-3333-4333-8333-333333333317';

  const PROD_CA_PHE_SUA = '11111111-1111-4111-8111-111111111102';
  const PROD_NO_RECIPE = '11111111-1111-4111-8111-111111111199';

  const TOP_KEM = '22222222-2222-4222-8222-222222222201';
  const TOP_PEARL = '22222222-2222-4222-8222-222222222202';
  const TOP_NO_RECIPE = '22222222-2222-4222-8222-222222222203';
  const TOP_INACTIVE = '22222222-2222-4222-8222-222222222299';

  it('detail của Cà phê sữa với 250g cà phê và đủ sữa đặc trả sizes S=10, M=7, L=6 và topping hết nguyên liệu trả stock=0', async () => {
    const prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: PROD_CA_PHE_SUA,
          name: 'Cà phê sữa',
          description: 'Cà phê phin đậm đà pha cùng sữa đặc',
          price: 35000,
          imageUrl: 'http://localhost:3000/images/ca-phe-sua.jpg',
          sizes: [
            { size: 'L', price: 45000 },
            { size: 'S', price: 35000 },
            { size: 'M', price: 40000 },
          ],
          toppings: [
            { topping: { id: TOP_PEARL, name: 'Trân châu', price: 8000, active: true } },
            { topping: { id: TOP_KEM, name: 'Kem', price: 10000, active: true } },
            { topping: { id: TOP_INACTIVE, name: 'Topping ẩn', price: 5000, active: false } },
          ],
        }),
      },
      productIngredient: {
        findMany: jest.fn().mockResolvedValue([
          {
            productId: PROD_CA_PHE_SUA,
            ingredientId: ING_COFFEE,
            amount: 25,
            ingredient: { unit: 'GRAM', stock: 250 },
          },
          {
            productId: PROD_CA_PHE_SUA,
            ingredientId: ING_CONDENSED_MILK,
            amount: 30,
            ingredient: { unit: 'GRAM', stock: 3800 },
          },
        ]),
      },
      toppingIngredient: {
        findMany: jest.fn().mockResolvedValue([
          {
            toppingId: TOP_KEM,
            ingredientId: ING_CREAM,
            amount: 30,
            ingredient: { unit: 'ML', stock: 0 },
          },
          {
            toppingId: TOP_PEARL,
            ingredientId: ING_PEARL,
            amount: 50,
            ingredient: { unit: 'GRAM', stock: 120 },
          },
        ]),
      },
    };

    const service = new ProductsService(prisma as unknown as PrismaService);
    const detail = await service.detail(PROD_CA_PHE_SUA);

    expect(detail).toEqual({
      id: PROD_CA_PHE_SUA,
      name: 'Cà phê sữa',
      description: 'Cà phê phin đậm đà pha cùng sữa đặc',
      price: 35000,
      imageUrl: 'http://localhost:3000/images/ca-phe-sua.jpg',
      stock: 10,
      sizes: [
        { size: 'S', price: 35000, stock: 10 },
        { size: 'M', price: 40000, stock: 7 },
        { size: 'L', price: 45000, stock: 6 },
      ],
      toppings: [
        { id: TOP_KEM, name: 'Kem', price: 10000, stock: 0 },
        { id: TOP_PEARL, name: 'Trân châu', price: 8000, stock: 2 },
      ],
    });
  });

  it('list trả stock bằng số ly size S và gộp truy vấn công thức cho cả trang (không N+1)', async () => {
    const prisma = {
      product: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          {
            id: PROD_CA_PHE_SUA,
            name: 'Cà phê sữa',
            description: 'Cà phê phin đậm đà',
            price: 35000,
            imageUrl: 'http://localhost:3000/images/ca-phe-sua.jpg',
          },
          {
            id: PROD_NO_RECIPE,
            name: 'Món mới chưa nhập công thức',
            description: 'Chưa có công thức',
            price: 40000,
            imageUrl: 'http://localhost:3000/images/new.jpg',
          },
        ]),
      },
      productIngredient: {
        findMany: jest.fn().mockResolvedValue([
          {
            productId: PROD_CA_PHE_SUA,
            ingredientId: ING_COFFEE,
            amount: 25,
            ingredient: { unit: 'GRAM', stock: 250 },
          },
          {
            productId: PROD_CA_PHE_SUA,
            ingredientId: ING_CONDENSED_MILK,
            amount: 30,
            ingredient: { unit: 'GRAM', stock: 3800 },
          },
        ]),
      },
      toppingIngredient: {
        findMany: jest.fn(),
      },
    };

    const service = new ProductsService(prisma as unknown as PrismaService);
    const page = await service.list({ page: 1, limit: 12 });

    expect(page).toEqual({
      data: [
        {
          id: PROD_CA_PHE_SUA,
          name: 'Cà phê sữa',
          description: 'Cà phê phin đậm đà',
          price: 35000,
          imageUrl: 'http://localhost:3000/images/ca-phe-sua.jpg',
          stock: 10,
        },
        {
          id: PROD_NO_RECIPE,
          name: 'Món mới chưa nhập công thức',
          description: 'Chưa có công thức',
          price: 40000,
          imageUrl: 'http://localhost:3000/images/new.jpg',
          stock: 0,
        },
      ],
      meta: { page: 1, limit: 12, total: 2, totalPages: 1 },
    });
    expect(prisma.productIngredient.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.toppingIngredient.findMany).not.toHaveBeenCalled();
  });

  it('(Review 5) món và topping chưa có công thức trong detail đều trả stock = 0', async () => {
    const prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: PROD_NO_RECIPE,
          name: 'Món mới chưa có công thức',
          description: 'Chưa khai báo nguyên liệu',
          price: 40000,
          imageUrl: 'http://localhost:3000/images/no-recipe.jpg',
          sizes: [
            { size: 'S', price: 40000 },
            { size: 'M', price: 45000 },
            { size: 'L', price: 50000 },
          ],
          toppings: [
            { topping: { id: TOP_NO_RECIPE, name: 'Topping mới', price: 7000, active: true } },
          ],
        }),
      },
      productIngredient: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      toppingIngredient: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const service = new ProductsService(prisma as unknown as PrismaService);
    const detail = await service.detail(PROD_NO_RECIPE);

    expect(detail.stock).toBe(0);
    expect(detail.sizes).toEqual([
      { size: 'S', price: 40000, stock: 0 },
      { size: 'M', price: 45000, stock: 0 },
      { size: 'L', price: 50000, stock: 0 },
    ]);
    expect(detail.toppings).toEqual([
      { id: TOP_NO_RECIPE, name: 'Topping mới', price: 7000, stock: 0 },
    ]);
  });
});

