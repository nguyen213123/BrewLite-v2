// Owner: TV1 — dữ liệu mẫu catalog + khuyến mãi. Generate Prisma, rồi build:seed và seed theo README.
// Chạy lại seed = RESET trạng thái demo (stock, usedCount) nhưng không xóa đơn hàng.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, IngredientUnit } from '../generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://brewlite:brewlite_dev@localhost:5432/brewlite?schema=public',
  }),
});
const frontend = process.env.FRONTEND_URL ?? 'http://localhost:3000';

const ing = (nn: number) => `33333333-3333-4333-8333-3333333333${String(nn).padStart(2, '0')}`;

// ID cố định khớp docs/api/examples.json (Cappuccino, Kem, SAVE10).
const toppings = [
  { id: '22222222-2222-4222-8222-222222222222', name: 'Kem', price: 10000 },
  { id: '22222222-2222-4222-8222-222222222223', name: 'Trân châu', price: 8000 },
  { id: '22222222-2222-4222-8222-222222222224', name: 'Thạch trái cây', price: 7000 },
  { id: '22222222-2222-4222-8222-222222222225', name: 'Pudding trứng', price: 9000 },
  { id: '22222222-2222-4222-8222-222222222226', name: 'Thạch cà phê', price: 7000 },
];
const allToppings = toppings.map(t => t.id);

type SeedIngredient = {
  id: string;
  name: string;
  unit: IngredientUnit;
  stock: number;
  packageSize: number;
  packageLabel: string;
};

// Dữ liệu nguyên liệu theo mục A7
const ingredients: SeedIngredient[] = [
  { id: ing(1), name: 'Cà phê hạt', unit: 'GRAM', packageSize: 250, packageLabel: 'túi', stock: 2500 },
  { id: ing(2), name: 'Sữa tươi', unit: 'ML', packageSize: 1000, packageLabel: 'hộp', stock: 10000 },
  { id: ing(3), name: 'Sữa đặc', unit: 'GRAM', packageSize: 380, packageLabel: 'lon', stock: 3800 },
  { id: ing(4), name: 'Trà đen', unit: 'GRAM', packageSize: 100, packageLabel: 'gói', stock: 500 },
  { id: ing(5), name: 'Trà nhài', unit: 'GRAM', packageSize: 100, packageLabel: 'gói', stock: 300 },
  { id: ing(6), name: 'Trà oolong', unit: 'GRAM', packageSize: 100, packageLabel: 'gói', stock: 300 },
  { id: ing(7), name: 'Bột matcha', unit: 'GRAM', packageSize: 100, packageLabel: 'gói', stock: 350 },
  { id: ing(8), name: 'Bột cacao', unit: 'GRAM', packageSize: 500, packageLabel: 'gói', stock: 750 },
  { id: ing(9), name: 'Sốt caramel', unit: 'ML', packageSize: 500, packageLabel: 'chai', stock: 0 },
  { id: ing(10), name: 'Đào ngâm', unit: 'GRAM', packageSize: 820, packageLabel: 'hộp', stock: 1640 },
  { id: ing(11), name: 'Vải ngâm', unit: 'GRAM', packageSize: 565, packageLabel: 'hộp', stock: 1130 },
  { id: ing(12), name: 'Chanh tươi', unit: 'PIECE', packageSize: 10, packageLabel: 'túi', stock: 50 },
  { id: ing(13), name: 'Hoa cúc khô', unit: 'GRAM', packageSize: 100, packageLabel: 'gói', stock: 200 },
  { id: ing(14), name: 'Mật ong', unit: 'ML', packageSize: 500, packageLabel: 'chai', stock: 1000 },
  { id: ing(15), name: 'Kem muối', unit: 'ML', packageSize: 500, packageLabel: 'hộp', stock: 1000 },
  { id: ing(16), name: 'Kem tươi', unit: 'ML', packageSize: 1000, packageLabel: 'hộp', stock: 1000 },
  { id: ing(17), name: 'Trân châu', unit: 'GRAM', packageSize: 1000, packageLabel: 'túi', stock: 3000 },
  { id: ing(18), name: 'Thạch trái cây', unit: 'GRAM', packageSize: 1000, packageLabel: 'hộp', stock: 2000 },
  { id: ing(19), name: 'Pudding trứng', unit: 'PIECE', packageSize: 20, packageLabel: 'hộp', stock: 40 },
  { id: ing(20), name: 'Thạch cà phê', unit: 'GRAM', packageSize: 1000, packageLabel: 'túi', stock: 1500 },
];

type RecipeLine = { ingredientId: string; amount: number };

// Công thức topping (1 phần theo mục A7)
const toppingRecipes: Record<string, RecipeLine[]> = {
  // Kem: 16·30
  '22222222-2222-4222-8222-222222222222': [
    { ingredientId: ing(16), amount: 30 },
  ],
  // Trân châu: 17·50
  '22222222-2222-4222-8222-222222222223': [
    { ingredientId: ing(17), amount: 50 },
  ],
  // Thạch trái cây: 18·50
  '22222222-2222-4222-8222-222222222224': [
    { ingredientId: ing(18), amount: 50 },
  ],
  // Pudding trứng: 19·1
  '22222222-2222-4222-8222-222222222225': [
    { ingredientId: ing(19), amount: 1 },
  ],
  // Thạch cà phê: 20·50
  '22222222-2222-4222-8222-222222222226': [
    { ingredientId: ing(20), amount: 50 },
  ],
};

type SeedProduct = { id: string; name: string; description: string; price: number; image: string; toppingIds: string[] };

// price = giá size S; M = +5.000; L = +10.000 (Cappuccino M=50.000 khớp ca nghiệm thu).
const products: SeedProduct[] = [
  // --- 4 món gốc (khớp examples.json, không đổi) ---
  { id: '11111111-1111-4111-8111-111111111111', name: 'Cappuccino', description: 'Cà phê espresso và sữa', price: 45000, image: 'cappuccino', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111112', name: 'Cà phê sữa', description: 'Cà phê phin đậm vị, sữa đặc', price: 35000, image: 'ca-phe-sua', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111113', name: 'Americano', description: 'Espresso pha loãng với nước nóng', price: 40000, image: 'americano', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111114', name: 'Trà đào', description: 'Trà đen, đào miếng và sả', price: 39000, image: 'tra-dao', toppingIds: allToppings },
  // --- món bổ sung ---
  { id: '11111111-1111-4111-8111-111111111115', name: 'Bạc xỉu', description: 'Nhiều sữa, ít cà phê, vị ngọt dịu', price: 38000, image: 'bac-xiu', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111116', name: 'Latte', description: 'Espresso với sữa nóng đánh mịn', price: 48000, image: 'latte', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111117', name: 'Espresso', description: 'Một shot cà phê nguyên chất, đậm', price: 32000, image: 'espresso', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111118', name: 'Mocha', description: 'Cà phê, sô cô la và sữa', price: 52000, image: 'mocha', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111119', name: 'Cà phê muối', description: 'Cà phê sữa phủ lớp kem muối béo mặn', price: 42000, image: 'ca-phe-muoi', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111120', name: 'Caramel Macchiato', description: 'Espresso, sữa và sốt caramel', price: 55000, image: 'caramel', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111121', name: 'Trà vải', description: 'Trà hoa nhài, vải thiều ngọt thanh', price: 39000, image: 'tra-vai', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111122', name: 'Trà chanh', description: 'Trà đen vắt chanh tươi, mát lạnh', price: 30000, image: 'tra-chanh', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111123', name: 'Trà sữa trân châu', description: 'Trà sữa truyền thống, trân châu dai', price: 45000, image: 'tra-sua', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111124', name: 'Trà oolong sữa', description: 'Oolong rang thơm, sữa béo nhẹ', price: 45000, image: 'tra-oolong', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111125', name: 'Trà hoa cúc mật ong', description: 'Hoa cúc, mật ong, thanh nhiệt', price: 36000, image: 'tra-hoa-cuc', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111126', name: 'Matcha latte', description: 'Bột matcha Nhật Bản với sữa tươi', price: 52000, image: 'matcha', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111127', name: 'Sô cô la đá xay', description: 'Cacao đậm vị xay cùng đá', price: 55000, image: 'socola', toppingIds: allToppings },
];
const sizeExtra = { S: 0, M: 5000, L: 10000 } as const;

// Công thức món (lượng cho size S theo mục A7)
const productRecipes: Record<string, RecipeLine[]> = {
  // Cappuccino: 01·18, 02·120
  '11111111-1111-4111-8111-111111111111': [
    { ingredientId: ing(1), amount: 18 },
    { ingredientId: ing(2), amount: 120 },
  ],
  // Cà phê sữa: 01·25, 03·30
  '11111111-1111-4111-8111-111111111112': [
    { ingredientId: ing(1), amount: 25 },
    { ingredientId: ing(3), amount: 30 },
  ],
  // Americano: 01·18
  '11111111-1111-4111-8111-111111111113': [
    { ingredientId: ing(1), amount: 18 },
  ],
  // Trà đào: 04·5, 10·60
  '11111111-1111-4111-8111-111111111114': [
    { ingredientId: ing(4), amount: 5 },
    { ingredientId: ing(10), amount: 60 },
  ],
  // Bạc xỉu: 01·10, 03·30, 02·80
  '11111111-1111-4111-8111-111111111115': [
    { ingredientId: ing(1), amount: 10 },
    { ingredientId: ing(3), amount: 30 },
    { ingredientId: ing(2), amount: 80 },
  ],
  // Latte: 01·18, 02·180
  '11111111-1111-4111-8111-111111111116': [
    { ingredientId: ing(1), amount: 18 },
    { ingredientId: ing(2), amount: 180 },
  ],
  // Espresso: 01·18
  '11111111-1111-4111-8111-111111111117': [
    { ingredientId: ing(1), amount: 18 },
  ],
  // Mocha: 01·18, 08·20, 02·120
  '11111111-1111-4111-8111-111111111118': [
    { ingredientId: ing(1), amount: 18 },
    { ingredientId: ing(8), amount: 20 },
    { ingredientId: ing(2), amount: 120 },
  ],
  // Cà phê muối: 01·25, 03·20, 15·40
  '11111111-1111-4111-8111-111111111119': [
    { ingredientId: ing(1), amount: 25 },
    { ingredientId: ing(3), amount: 20 },
    { ingredientId: ing(15), amount: 40 },
  ],
  // Caramel Macchiato: 01·18, 02·150, 09·20 (hết hàng do sốt caramel tồn = 0)
  '11111111-1111-4111-8111-111111111120': [
    { ingredientId: ing(1), amount: 18 },
    { ingredientId: ing(2), amount: 150 },
    { ingredientId: ing(9), amount: 20 },
  ],
  // Trà vải: 05·5, 11·60
  '11111111-1111-4111-8111-111111111121': [
    { ingredientId: ing(5), amount: 5 },
    { ingredientId: ing(11), amount: 60 },
  ],
  // Trà chanh: 04·5, 12·1
  '11111111-1111-4111-8111-111111111122': [
    { ingredientId: ing(4), amount: 5 },
    { ingredientId: ing(12), amount: 1 },
  ],
  // Trà sữa trân châu: 04·6, 02·100, 17·50
  '11111111-1111-4111-8111-111111111123': [
    { ingredientId: ing(4), amount: 6 },
    { ingredientId: ing(2), amount: 100 },
    { ingredientId: ing(17), amount: 50 },
  ],
  // Trà oolong sữa: 06·6, 02·100
  '11111111-1111-4111-8111-111111111124': [
    { ingredientId: ing(6), amount: 6 },
    { ingredientId: ing(2), amount: 100 },
  ],
  // Trà hoa cúc mật ong: 13·3, 14·15
  '11111111-1111-4111-8111-111111111125': [
    { ingredientId: ing(13), amount: 3 },
    { ingredientId: ing(14), amount: 15 },
  ],
  // Matcha latte: 07·10, 02·180
  '11111111-1111-4111-8111-111111111126': [
    { ingredientId: ing(7), amount: 10 },
    { ingredientId: ing(2), amount: 180 },
  ],
  // Sô cô la đá xay: 08·30, 02·120
  '11111111-1111-4111-8111-111111111127': [
    { ingredientId: ing(8), amount: 30 },
    { ingredientId: ing(2), amount: 120 },
  ],
};

const promotions = [
  // SAVE10 khớp examples.json: 10%, đơn tối thiểu 100.000đ, giảm tối đa 30.000đ, 100 lượt.
  { code: 'SAVE10', type: 'PERCENT', value: 10, minSubtotal: 100000, maxDiscount: 30000, maxUses: 100, endsAt: new Date('2030-01-01T00:00:00Z') },
  { code: 'GIAM20K', type: 'FIXED', value: 20000, minSubtotal: 80000, maxDiscount: null, maxUses: null, endsAt: new Date('2030-01-01T00:00:00Z') },
  // OLD10 = mã hết hạn dùng trong ví dụ "promotion expired" (422 PROMOTION_INVALID) của examples.json.
  { code: 'OLD10', type: 'PERCENT', value: 10, minSubtotal: 0, maxDiscount: null, maxUses: null, endsAt: new Date('2026-02-01T00:00:00Z') },
] as const;


async function main() {
  for (const t of toppings) {
    await prisma.topping.upsert({ where: { id: t.id }, create: { ...t, active: true }, update: { name: t.name, price: t.price, active: true } });
  }

  for (const ingItem of ingredients) {
    await prisma.ingredient.upsert({
      where: { id: ingItem.id },
      create: {
        id: ingItem.id,
        name: ingItem.name,
        unit: ingItem.unit,
        stock: ingItem.stock,
        packageSize: ingItem.packageSize,
        packageLabel: ingItem.packageLabel,
        version: 0,
      },
      update: {
        name: ingItem.name,
        unit: ingItem.unit,
        stock: ingItem.stock,
        packageSize: ingItem.packageSize,
        packageLabel: ingItem.packageLabel,
        version: 0,
      },
    });
  }

  for (const t of toppings) {
    const lines = toppingRecipes[t.id] ?? [];
    const ingredientIds = lines.map(l => l.ingredientId);
    await prisma.toppingIngredient.deleteMany({
      where: { toppingId: t.id, ingredientId: { notIn: ingredientIds } },
    });
    for (const line of lines) {
      await prisma.toppingIngredient.upsert({
        where: { toppingId_ingredientId: { toppingId: t.id, ingredientId: line.ingredientId } },
        create: { toppingId: t.id, ingredientId: line.ingredientId, amount: line.amount },
        update: { amount: line.amount },
      });
    }
  }

  for (const p of products) {
    const data = { name: p.name, description: p.description, price: p.price, imageUrl: `${frontend}/images/${p.image}.jpg`, version: 0, active: true };
    await prisma.product.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
    for (const size of ['S', 'M', 'L'] as const) {
      const price = p.price + sizeExtra[size];
      await prisma.productSize.upsert({
        where: { productId_size: { productId: p.id, size } },
        create: { productId: p.id, size, price },
        update: { price },
      });
    }
    await prisma.productTopping.deleteMany({ where: { productId: p.id, toppingId: { notIn: p.toppingIds } } });
    for (const toppingId of p.toppingIds) {
      await prisma.productTopping.upsert({
        where: { productId_toppingId: { productId: p.id, toppingId } },
        create: { productId: p.id, toppingId },
        update: {},
      });
    }
    const lines = productRecipes[p.id] ?? [];
    const ingredientIds = lines.map(l => l.ingredientId);
    await prisma.productIngredient.deleteMany({
      where: { productId: p.id, ingredientId: { notIn: ingredientIds } },
    });
    for (const line of lines) {
      await prisma.productIngredient.upsert({
        where: { productId_ingredientId: { productId: p.id, ingredientId: line.ingredientId } },
        create: { productId: p.id, ingredientId: line.ingredientId, amount: line.amount },
        update: { amount: line.amount },
      });
    }
  }

  for (const promo of promotions) {
    const data = { ...promo, startsAt: new Date('2026-01-01T00:00:00Z'), usedCount: 0, active: true };
    await prisma.promotion.upsert({ where: { code: promo.code }, create: data, update: data });
  }

  console.log(`Seed xong: ${products.length} sản phẩm, ${toppings.length} topping, ${ingredients.length} nguyên liệu, ${promotions.length} mã khuyến mãi.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
