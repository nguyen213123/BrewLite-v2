import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  filterAndSortProducts,
  getCategoryCounts,
  getProductCategory,
  normalizeVietnamese,
} from './filter.ts';

const SAMPLE_PRODUCTS = [
  { id: '1', name: 'Cappuccino', description: 'Cà phê espresso và sữa', price: 45000, stock: 20 },
  { id: '2', name: 'Cà phê sữa', description: 'Cà phê phin đậm vị, sữa đặc', price: 35000, stock: 50 },
  { id: '3', name: 'Americano', description: 'Espresso pha loãng với nước nóng', price: 40000, stock: 50 },
  { id: '4', name: 'Trà đào', description: 'Trà đen, đào miếng và sả', price: 39000, stock: 50 },
  { id: '5', name: 'Bạc xỉu', description: 'Nhiều sữa, ít cà phê, vị ngọt dịu', price: 38000, stock: 40 },
  { id: '6', name: 'Latte', description: 'Espresso với sữa nóng đánh mịn', price: 48000, stock: 40 },
  { id: '7', name: 'Espresso', description: 'Một shot cà phê nguyên chất, đậm', price: 32000, stock: 30 },
  { id: '8', name: 'Mocha', description: 'Cà phê, sô cô la và sữa', price: 52000, stock: 35 },
  { id: '9', name: 'Cà phê muối', description: 'Cà phê sữa phủ lớp kem muối béo mặn', price: 42000, stock: 40 },
  { id: '10', name: 'Caramel Macchiato', description: 'Espresso, sữa và sốt caramel', price: 55000, stock: 0 },
  { id: '11', name: 'Trà vải', description: 'Trà hoa nhài, vải thiều ngọt thanh', price: 39000, stock: 50 },
  { id: '12', name: 'Trà chanh', description: 'Trà đen vắt chanh tươi, mát lạnh', price: 30000, stock: 50 },
  { id: '13', name: 'Trà sữa trân châu', description: 'Trà sữa truyền thống, trân châu dai', price: 45000, stock: 45 },
  { id: '14', name: 'Trà oolong sữa', description: 'Oolong rang thơm, sữa béo nhẹ', price: 45000, stock: 40 },
  { id: '15', name: 'Trà hoa cúc mật ong', description: 'Hoa cúc, mật ong, thanh nhiệt', price: 36000, stock: 40 },
  { id: '16', name: 'Matcha latte', description: 'Bột matcha Nhật Bản với sữa tươi', price: 52000, stock: 35 },
  { id: '17', name: 'Sô cô la đá xay', description: 'Cacao đậm vị xay cùng đá', price: 55000, stock: 30 },
];

describe('Bộ lọc tìm kiếm sản phẩm (Product Filter & Search)', () => {
  describe('normalizeVietnamese', () => {
    it('bỏ dấu, chuyển chữ thường và xử lý chữ đ/Đ', () => {
      assert.equal(normalizeVietnamese('Cà Phê Sữa Đá'), 'ca phe sua da');
      assert.equal(normalizeVietnamese('Đà Nẵng - ĐỒ UỐNG'), 'da nang - do uong');
      assert.equal(normalizeVietnamese('  Bạc xỉu nhiều sữa  '), 'bac xiu nhieu sua');
    });
  });

  describe('getProductCategory', () => {
    it('nhận diện đúng các món Cà phê', () => {
      assert.equal(getProductCategory('Cappuccino'), 'COFFEE');
      assert.equal(getProductCategory('Cà phê sữa'), 'COFFEE');
      assert.equal(getProductCategory('Bạc xỉu'), 'COFFEE');
      assert.equal(getProductCategory('Caramel Macchiato'), 'COFFEE');
    });

    it('nhận diện đúng các món Trà & Trà sữa', () => {
      assert.equal(getProductCategory('Trà đào'), 'TEA');
      assert.equal(getProductCategory('Trà sữa trân châu'), 'TEA');
      assert.equal(getProductCategory('Trà oolong sữa'), 'TEA');
      assert.equal(getProductCategory('Trà hoa cúc mật ong'), 'TEA');
    });

    it('nhận diện đúng các món Đá xay / Đặc biệt', () => {
      assert.equal(getProductCategory('Matcha latte'), 'SPECIAL');
      assert.equal(getProductCategory('Sô cô la đá xay'), 'SPECIAL');
    });
  });

  describe('getCategoryCounts', () => {
    it('đếm đúng số lượng từng danh mục trên toàn bộ catalog 17 món', () => {
      const counts = getCategoryCounts(SAMPLE_PRODUCTS);
      assert.equal(counts.ALL, 17);
      assert.equal(counts.COFFEE, 9);
      assert.equal(counts.TEA, 6);
      assert.equal(counts.SPECIAL, 2);
    });
  });

  describe('filterAndSortProducts', () => {
    it('trả về danh sách gốc khi không có tùy chọn lọc', () => {
      const result = filterAndSortProducts(SAMPLE_PRODUCTS);
      assert.equal(result.length, 17);
    });

    it('lọc theo danh mục Cà phê (COFFEE)', () => {
      const result = filterAndSortProducts(SAMPLE_PRODUCTS, { category: 'COFFEE' });
      assert.equal(result.length, 9);
      assert.ok(result.every((p) => getProductCategory(p.name, p.description) === 'COFFEE'));
    });

    it('lọc theo danh mục Trà (TEA)', () => {
      const result = filterAndSortProducts(SAMPLE_PRODUCTS, { category: 'TEA' });
      assert.equal(result.length, 6);
      assert.ok(result.every((p) => getProductCategory(p.name, p.description) === 'TEA'));
    });

    it('lọc chỉ hiện món còn hàng (inStockOnly)', () => {
      const result = filterAndSortProducts(SAMPLE_PRODUCTS, { inStockOnly: true });
      assert.equal(result.length, 16);
      assert.ok(!result.some((p) => p.name === 'Caramel Macchiato'));
    });

    it('tìm kiếm không dấu "ca phe" tìm thấy các món cà phê liên quan', () => {
      const result = filterAndSortProducts(SAMPLE_PRODUCTS, { query: 'ca phe' });
      assert.ok(result.length >= 3);
      assert.ok(result.some((p) => p.name === 'Cà phê sữa'));
      assert.ok(result.some((p) => p.name === 'Cà phê muối'));
    });

    it('tìm kiếm theo mô tả (ví dụ: "phin" tìm thấy "Cà phê sữa")', () => {
      const result = filterAndSortProducts(SAMPLE_PRODUCTS, { query: 'phin' });
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'Cà phê sữa');
    });

    it('tìm kiếm nhiều từ không phân biệt hoa thường "tra sua"', () => {
      const result = filterAndSortProducts(SAMPLE_PRODUCTS, { query: 'tra sua' });
      assert.ok(result.some((p) => p.name === 'Trà sữa trân châu'));
      assert.ok(result.some((p) => p.name === 'Trà oolong sữa'));
    });

    it('kết hợp lọc danh mục + còn hàng + tìm kiếm', () => {
      const result = filterAndSortProducts(SAMPLE_PRODUCTS, {
        category: 'COFFEE',
        inStockOnly: true,
        query: 'macchiato',
      });
      // Caramel Macchiato hết hàng (stock 0) nên kết quả phải rỗng
      assert.equal(result.length, 0);
    });

    it('sắp xếp theo giá tăng dần (PRICE_ASC)', () => {
      const result = filterAndSortProducts(SAMPLE_PRODUCTS, { sortBy: 'PRICE_ASC' });
      assert.equal(result[0].name, 'Trà chanh'); // 30.000₫
      assert.equal(result[0].price, 30000);
      for (let i = 0; i < result.length - 1; i++) {
        assert.ok(result[i].price <= result[i + 1].price);
      }
    });

    it('sắp xếp theo giá giảm dần (PRICE_DESC)', () => {
      const result = filterAndSortProducts(SAMPLE_PRODUCTS, { sortBy: 'PRICE_DESC' });
      assert.equal(result[0].price, 55000); // 55.000₫
      for (let i = 0; i < result.length - 1; i++) {
        assert.ok(result[i].price >= result[i + 1].price);
      }
    });

    it('sắp xếp theo tên A-Z (NAME_ASC)', () => {
      const result = filterAndSortProducts(SAMPLE_PRODUCTS, { sortBy: 'NAME_ASC' });
      assert.equal(result[0].name, 'Americano');
    });
  });
});
