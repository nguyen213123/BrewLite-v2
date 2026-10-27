// Owner: TV3 — Kiểm thử hàm tính công thức nguyên liệu thuần túy (spec A3)
import type { CartItem } from '../src/common/contracts/api.generated';
import {
  SIZE_FACTOR_PCT,
  type RecipeBook,
  type RecipeLine,
  availableCups,
  perCupAmount,
  requiredIngredients,
} from '../src/modules/inventory/domain/recipe';

describe('Công thức nguyên liệu (domain/recipe)', () => {
  describe('SIZE_FACTOR_PCT & perCupAmount', () => {
    it('định nghĩa đúng hệ số size theo spec A3', () => {
      expect(SIZE_FACTOR_PCT).toEqual({ S: 100, M: 125, L: 150 });
    });

    it('tính đúng lượng nguyên liệu GRAM cho size S, M, L với làm tròn lên (ceil)', () => {
      const line: RecipeLine = { ingredientId: 'ing-01', amount: 25, unit: 'GRAM' };
      // 25 * 100% = 25
      expect(perCupAmount(line, 'S')).toBe(25);
      // 25 * 125% = 31.25 -> ceil = 32
      expect(perCupAmount(line, 'M')).toBe(32);
      // 25 * 150% = 37.5 -> ceil = 38
      expect(perCupAmount(line, 'L')).toBe(38);
    });

    it('nguyên liệu đơn vị PIECE không bị nhân hệ số size', () => {
      const line: RecipeLine = { ingredientId: 'ing-12', amount: 1, unit: 'PIECE' };
      expect(perCupAmount(line, 'S')).toBe(1);
      expect(perCupAmount(line, 'M')).toBe(1);
      expect(perCupAmount(line, 'L')).toBe(1);

      const multiPieces: RecipeLine = { ingredientId: 'ing-12', amount: 2, unit: 'PIECE' };
      expect(perCupAmount(multiPieces, 'L')).toBe(2);
    });

    it('tính đúng lượng nguyên liệu ML cho size S, M, L', () => {
      const line: RecipeLine = { ingredientId: 'ing-02', amount: 120, unit: 'ML' };
      // 120 * 100% = 120
      expect(perCupAmount(line, 'S')).toBe(120);
      // 120 * 125% = 150
      expect(perCupAmount(line, 'M')).toBe(150);
      // 120 * 150% = 180
      expect(perCupAmount(line, 'L')).toBe(180);
    });
  });

  describe('availableCups', () => {
    it('trả về 0 khi công thức rỗng (chưa có công thức)', () => {
      const stock = new Map<string, number>([['ing-01', 1000]]);
      expect(availableCups([], 'S', stock)).toBe(0);
      expect(availableCups([], 'M', stock)).toBe(0);
      expect(availableCups([], 'L', stock)).toBe(0);
      expect(availableCups([], null, stock)).toBe(0);
    });

    it('tính đúng số ly Cà phê sữa pha được với 250g cà phê theo spec A3', () => {
      // Cà phê sữa: 25g cà phê (ing-01), 30g sữa đặc (ing-03)
      const lines: RecipeLine[] = [
        { ingredientId: 'ing-01', amount: 25, unit: 'GRAM' },
        { ingredientId: 'ing-03', amount: 30, unit: 'GRAM' },
      ];
      const stock = new Map<string, number>([
        ['ing-01', 250],
        ['ing-03', 3800],
      ]);

      // Size S: ing-01 cần 25g (250/25 = 10), ing-03 cần 30g (3800/30 = 126) -> min = 10
      expect(availableCups(lines, 'S', stock)).toBe(10);
      // Size M: ing-01 cần 32g (floor(250/32) = 7), ing-03 cần 38g (floor(3800/38) = 100) -> min = 7
      expect(availableCups(lines, 'M', stock)).toBe(7);
      // Size L: ing-01 cần 38g (floor(250/38) = 6), ing-03 cần 45g (floor(3800/45) = 84) -> min = 6
      expect(availableCups(lines, 'L', stock)).toBe(6);
    });

    it('bị giới hạn bởi nguyên liệu cạn nhất (bottleneck)', () => {
      const lines: RecipeLine[] = [
        { ingredientId: 'ing-01', amount: 25, unit: 'GRAM' },
        { ingredientId: 'ing-03', amount: 30, unit: 'GRAM' },
      ];
      // ing-03 chỉ còn 60g -> đủ 2 ly S, dù ing-01 có 1000g
      const stock = new Map<string, number>([
        ['ing-01', 1000],
        ['ing-03', 60],
      ]);
      expect(availableCups(lines, 'S', stock)).toBe(2);
    });

    it('trả về 0 khi thiếu nguyên liệu trong kho hoặc tồn <= 0', () => {
      const lines: RecipeLine[] = [{ ingredientId: 'ing-01', amount: 25, unit: 'GRAM' }];
      expect(availableCups(lines, 'S', new Map())).toBe(0);
      expect(availableCups(lines, 'S', new Map([['ing-01', 0]]))).toBe(0);
      expect(availableCups(lines, 'S', new Map([['ing-01', -10]]))).toBe(0);
    });

    it('tính số phần topping còn lại khi size === null (không áp hệ số size)', () => {
      const lines: RecipeLine[] = [{ ingredientId: 'ing-17', amount: 50, unit: 'GRAM' }];
      const stock = new Map<string, number>([['ing-17', 120]]);
      // 120 / 50 = 2 phần
      expect(availableCups(lines, null, stock)).toBe(2);
    });
  });

  describe('requiredIngredients', () => {
    it('gộp nguyên liệu món và topping, chỉ xuất hiện một dòng và sắp xếp id tăng dần', () => {
      // Trà sữa trân châu: ing-04 (6g trà), ing-02 (100ml sữa), ing-17 (50g trân châu)
      // Topping Trân châu: ing-17 (50g trân châu)
      const book: RecipeBook = {
        products: new Map([
          [
            'prod-tra-sua',
            [
              { ingredientId: 'ing-04', amount: 6, unit: 'GRAM' },
              { ingredientId: 'ing-02', amount: 100, unit: 'ML' },
              { ingredientId: 'ing-17', amount: 50, unit: 'GRAM' },
            ],
          ],
        ]),
        toppings: new Map([
          [
            'top-tran-chau',
            [{ ingredientId: 'ing-17', amount: 50, unit: 'GRAM' }],
          ],
        ]),
      };

      const items: CartItem[] = [
        {
          productId: 'prod-tra-sua',
          size: 'S',
          qty: 2,
          toppingIds: ['top-tran-chau'],
        },
      ];

      // Với size S, qty 2:
      // ing-02: 100 * 2 = 200
      // ing-04: 6 * 2 = 12
      // ing-17: (50 món + 50 topping) * 2 = 200
      // Thứ tự id tăng dần: ing-02, ing-04, ing-17
      const result = requiredIngredients(book, items);
      expect(result).toEqual([
        ['ing-02', 200],
        ['ing-04', 12],
        ['ing-17', 200],
      ]);
    });

    it('sắp xếp theo ingredientId tăng dần kể cả khi khai báo không theo thứ tự', () => {
      const book: RecipeBook = {
        products: new Map([
          [
            'prod-mix',
            [
              { ingredientId: 'ing-99', amount: 10, unit: 'GRAM' },
              { ingredientId: 'ing-05', amount: 20, unit: 'GRAM' },
              { ingredientId: 'ing-01', amount: 30, unit: 'GRAM' },
            ],
          ],
        ]),
        toppings: new Map(),
      };

      const result = requiredIngredients(book, [
        { productId: 'prod-mix', size: 'S', qty: 1 },
      ]);
      expect(result).toEqual([
        ['ing-01', 30],
        ['ing-05', 20],
        ['ing-99', 10],
      ]);
    });

    it('trả về mảng rỗng nếu món không có trong recipe book (InventoryService sẽ ném lỗi)', () => {
      const book: RecipeBook = {
        products: new Map(),
        toppings: new Map(),
      };
      const result = requiredIngredients(book, [
        { productId: 'prod-unknown', size: 'S', qty: 1 },
      ]);
      expect(result).toEqual([]);
    });

    it('bỏ qua topping không có trong recipe book và xử lý toppingIds undefined', () => {
      const book: RecipeBook = {
        products: new Map([
          [
            'prod-tea',
            [{ ingredientId: 'ing-04', amount: 5, unit: 'GRAM' }],
          ],
        ]),
        toppings: new Map(),
      };

      const result = requiredIngredients(book, [
        { productId: 'prod-tea', size: 'S', qty: 1, toppingIds: ['unknown-topping'] },
        { productId: 'prod-tea', size: 'S', qty: 1 },
      ]);
      expect(result).toEqual([['ing-04', 10]]);
    });

    it('tính đúng khi nhiều món và nhiều size kết hợp', () => {
      const book: RecipeBook = {
        products: new Map([
          [
            'prod-coffee',
            [
              { ingredientId: 'ing-01', amount: 25, unit: 'GRAM' },
              { ingredientId: 'ing-02', amount: 100, unit: 'ML' },
            ],
          ],
          [
            'prod-latte',
            [
              { ingredientId: 'ing-01', amount: 18, unit: 'GRAM' },
              { ingredientId: 'ing-02', amount: 180, unit: 'ML' },
            ],
          ],
        ]),
        toppings: new Map(),
      };

      // Item 1: prod-coffee, size M, qty 1 -> ing-01: ceil(25*1.25)=32, ing-02: ceil(100*1.25)=125
      // Item 2: prod-latte, size L, qty 2 -> ing-01: ceil(18*1.5)*2=27*2=54, ing-02: ceil(180*1.5)*2=270*2=540
      // Total:
      // ing-01: 32 + 54 = 86
      // ing-02: 125 + 540 = 665
      const items: CartItem[] = [
        { productId: 'prod-coffee', size: 'M', qty: 1 },
        { productId: 'prod-latte', size: 'L', qty: 2 },
      ];

      expect(requiredIngredients(book, items)).toEqual([
        ['ing-01', 86],
        ['ing-02', 665],
      ]);
    });

    it('trả về mảng rỗng khi danh sách cart items rỗng', () => {
      const book: RecipeBook = {
        products: new Map(),
        toppings: new Map(),
      };
      expect(requiredIngredients(book, [])).toEqual([]);
    });
  });
});
