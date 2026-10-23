// Owner: TV1 — dữ liệu mẫu catalog + khuyến mãi. Chạy: npm --prefix backend run build && npm --prefix backend run seed
// Chạy lại seed = RESET trạng thái demo (stock, usedCount) nhưng không xóa đơn hàng.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://brewlite:brewlite_dev@localhost:5432/brewlite?schema=public',
  }),
});
const frontend = process.env.FRONTEND_URL ?? 'http://localhost:3000';

// ID cố định khớp docs/api/examples.json (Cappuccino, Kem, SAVE10).
const toppings = [
  { id: '22222222-2222-4222-8222-222222222222', name: 'Kem', price: 10000 },
  { id: '22222222-2222-4222-8222-222222222223', name: 'Trân châu', price: 8000 },
  { id: '22222222-2222-4222-8222-222222222224', name: 'Thạch trái cây', price: 7000 },
  { id: '22222222-2222-4222-8222-222222222225', name: 'Pudding trứng', price: 9000 },
  { id: '22222222-2222-4222-8222-222222222226', name: 'Thạch cà phê', price: 7000 },
];
const allToppings = toppings.map(t => t.id);

type SeedProduct = { id: string; name: string; description: string; price: number; stock: number; image: string; toppingIds: string[] };

// price = giá size S; M = +5.000; L = +10.000 (Cappuccino M=50.000 khớp ca nghiệm thu).
const products: SeedProduct[] = [
  // --- 4 món gốc (khớp examples.json, không đổi) ---
  { id: '11111111-1111-4111-8111-111111111111', name: 'Cappuccino', description: 'Cà phê espresso và sữa', price: 45000, stock: 20, image: 'cappuccino', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111112', name: 'Cà phê sữa', description: 'Cà phê phin đậm vị, sữa đặc', price: 35000, stock: 50, image: 'ca-phe-sua', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111113', name: 'Americano', description: 'Espresso pha loãng với nước nóng', price: 40000, stock: 50, image: 'americano', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111114', name: 'Trà đào', description: 'Trà đen, đào miếng và sả', price: 39000, stock: 50, image: 'tra-dao', toppingIds: allToppings },
  // --- món bổ sung ---
  { id: '11111111-1111-4111-8111-111111111115', name: 'Bạc xỉu', description: 'Nhiều sữa, ít cà phê, vị ngọt dịu', price: 38000, stock: 40, image: 'bac-xiu', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111116', name: 'Latte', description: 'Espresso với sữa nóng đánh mịn', price: 48000, stock: 40, image: 'latte', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111117', name: 'Espresso', description: 'Một shot cà phê nguyên chất, đậm', price: 32000, stock: 30, image: 'espresso', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111118', name: 'Mocha', description: 'Cà phê, sô cô la và sữa', price: 52000, stock: 35, image: 'mocha', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111119', name: 'Cà phê muối', description: 'Cà phê sữa phủ lớp kem muối béo mặn', price: 42000, stock: 40, image: 'ca-phe-muoi', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111120', name: 'Caramel Macchiato', description: 'Espresso, sữa và sốt caramel', price: 55000, stock: 0, image: 'caramel', toppingIds: allToppings }, // hết hàng: để test UI / OUT_OF_STOCK
  { id: '11111111-1111-4111-8111-111111111121', name: 'Trà vải', description: 'Trà hoa nhài, vải thiều ngọt thanh', price: 39000, stock: 50, image: 'tra-vai', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111122', name: 'Trà chanh', description: 'Trà đen vắt chanh tươi, mát lạnh', price: 30000, stock: 50, image: 'tra-chanh', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111123', name: 'Trà sữa trân châu', description: 'Trà sữa truyền thống, trân châu dai', price: 45000, stock: 45, image: 'tra-sua', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111124', name: 'Trà oolong sữa', description: 'Oolong rang thơm, sữa béo nhẹ', price: 45000, stock: 40, image: 'tra-oolong', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111125', name: 'Trà hoa cúc mật ong', description: 'Hoa cúc, mật ong, thanh nhiệt', price: 36000, stock: 40, image: 'tra-hoa-cuc', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111126', name: 'Matcha latte', description: 'Bột matcha Nhật Bản với sữa tươi', price: 52000, stock: 35, image: 'matcha', toppingIds: allToppings },
  { id: '11111111-1111-4111-8111-111111111127', name: 'Sô cô la đá xay', description: 'Cacao đậm vị xay cùng đá', price: 55000, stock: 30, image: 'socola', toppingIds: allToppings },
];
const sizeExtra = { S: 0, M: 5000, L: 10000 } as const;

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
  for (const p of products) {
    const data = { name: p.name, description: p.description, price: p.price, imageUrl: `${frontend}/images/${p.image}.jpg`, stock: p.stock, version: 0, active: true };
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
  }
  for (const promo of promotions) {
    const data = { ...promo, startsAt: new Date('2026-01-01T00:00:00Z'), usedCount: 0, active: true };
    await prisma.promotion.upsert({ where: { code: promo.code }, create: data, update: data });
  }
  console.log(`Seed xong: ${products.length} sản phẩm, ${toppings.length} topping, ${promotions.length} mã khuyến mãi.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
