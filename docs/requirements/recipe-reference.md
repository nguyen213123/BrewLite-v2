# Công thức nguyên liệu của món

Database hiện lưu công thức nguyên liệu chính theo từng món trong ba bảng:

- `Product` lưu thông tin món.
- `Ingredient` lưu tên, đơn vị và tồn kho của từng nguyên liệu.
- `ProductIngredient` liên kết món với nguyên liệu và ghi lượng dùng cho **một ly size S**.

Định lượng hiện tại là dữ liệu mẫu, chưa được quán xác nhận, và chưa phải danh sách đầy đủ mọi thành phần pha chế như nước, đá hoặc sả. `GRAM` là gam, `ML` là mililít và `PIECE` là đơn vị đếm. Sữa đặc đang được quản lý bằng gam; không tự quy đổi sang mililít khi chưa biết tỷ trọng.

Công thức nguyên liệu chính được hệ thống dùng để kiểm tra, giữ và hoàn tồn kho khi xử lý đơn. Với nguyên liệu có đơn vị `GRAM` hoặc `ML`, size M dùng 125% và size L dùng 150% lượng size S, làm tròn lên; `PIECE` giữ nguyên theo size. Topping có công thức riêng trong `ToppingIngredient` và được cộng thêm nếu khách chọn.

## Xem công thức đang lưu

Truy vấn PostgreSQL chỉ đọc sau liệt kê nguyên liệu chính và định lượng size S của từng món:

```sql
SELECT p.name AS mon, i.name AS nguyen_lieu,
       pi.amount AS luong_size_s, i.unit AS don_vi
FROM "Product" AS p
JOIN "ProductIngredient" AS pi ON pi."productId" = p.id
JOIN "Ingredient" AS i ON i.id = pi."ingredientId"
ORDER BY p.name, i.name;
```

Cũng có thể chạy `npm run db:studio` tại thư mục gốc dự án, sau đó xem các bảng `Product`, `Ingredient` và `ProductIngredient` trong Prisma Studio.

Không chạy lại seed trên database có dữ liệu cần giữ chỉ để xem hoặc thêm công thức: seed đặt lại tồn kho và lượt dùng khuyến mãi. Khi chỉnh `ProductIngredient`, lưu ý rằng định lượng mới ảnh hưởng việc kiểm tra và trừ kho của các đơn mới.
