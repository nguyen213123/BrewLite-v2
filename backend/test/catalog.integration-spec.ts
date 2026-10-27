
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProductsService } from '../src/modules/products/products.service';

// Chạy với RUN_DB_TESTS=1 và DATABASE_URL đã migrate.
const integration =
  process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

integration('Product catalog on PostgreSQL (Issue #2)', () => {
  let prisma: PrismaService;
  let products: ProductsService;

  const productId = randomUUID();
  const hiddenId = randomUUID();

  beforeAll(async () => {
    prisma = new PrismaService();
    products = new ProductsService(prisma);

    const base = {
      description: 'test',
      imageUrl: 'http://localhost/x.svg',
    };

    await prisma.product.create({
      data: {
        id: productId,
        name: 'Test Cappuccino',
        price: 45000,
        ...base,
      },
    });

    await prisma.product.create({
      data: {
        id: hiddenId,
        name: 'Test Hidden',
        price: 1000,
        active: false,
        ...base,
      },
    });

    await prisma.productSize.createMany({
      data: [
        { productId, size: 'L', price: 55000 },
        { productId, size: 'S', price: 45000 },
        { productId, size: 'M', price: 50000 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.productSize.deleteMany({
      where: { productId },
    });

    await prisma.product.deleteMany({
      where: { id: { in: [productId, hiddenId] } },
    });

    await prisma.$disconnect();
  });

  it('detail returns sizes S/M/L in order', async () => {
    const detail = await products.detail(productId);

    expect(detail.sizes.map((s) => s.size)).toEqual([
      'S',
      'M',
      'L',
    ]);
  });

  it('detail of inactive or missing product is 404 PRODUCT_NOT_FOUND', async () => {
    await expect(products.detail(hiddenId)).rejects.toMatchObject({
      response: { code: 'PRODUCT_NOT_FOUND' },
    });

    await expect(products.detail(randomUUID())).rejects.toMatchObject({
      response: { code: 'PRODUCT_NOT_FOUND' },
    });
  });

  it('list excludes inactive products and reports pagination meta', async () => {
    const page = await products.list({ page: 1, limit: 50 });

    expect(page.data.some((p) => p.id === productId)).toBe(true);
    expect(page.data.some((p) => p.id === hiddenId)).toBe(false);
    expect(page.meta.totalPages).toBe(
      Math.ceil(page.meta.total / 50),
    );
  });
});
