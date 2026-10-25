# Nghiệm thu Menu — Issue #4

Ngày kiểm tra: 26/10/2026 (Asia/Saigon). Mã nguồn: `0eed8fe258c5266f73e40ee3c47640cb4f00a22b`, gồm Menu PR #28 và các thay đổi tích hợp đã merge. Frontend production Docker gọi NestJS/PostgreSQL thật qua QA 3400/3401; không thay response bằng fixture trên trình duyệt.

| Tiêu chí | Kết quả và bằng chứng |
| --- | --- |
| Tên, ảnh, giá từ API; 17 sản phẩm | Đạt — [desktop](images/desktop-menu.png), [trang 2](images/desktop-page-2.png) |
| Chọn đúng sản phẩm theo ID | Đạt — [Cappuccino](images/product-navigation.png) |
| Mobile 390×844, không tràn ngang | Đạt — [menu mobile](images/mobile-menu.png); chiều rộng nội dung 375 ≤ 390 px |
| Loading khi API chưa phản hồi | Đạt — [loading](images/mobile-loading.png), làm chậm truy vấn bằng khóa bảng trong DB QA |
| API trả danh sách rỗng | Đạt — [desktop](images/desktop-empty.png), [mobile](images/mobile-empty.png) |
| API không kết nối được | Đạt — [desktop](images/desktop-error.png), [mobile](images/mobile-error.png) |
| Thử lại sau khi API hoạt động | Đạt — [kết quả sau Thử lại](images/mobile-retry-success.png) |

## Chạy lại

Từ thư mục gốc: `npm ci`, `npm run qa:up`, mở <http://localhost:3400>. QA có database tmpfs riêng; không chạy các câu SQL thử lỗi trên database phát triển.

- Loading: trong terminal QA chạy câu SQL bên dưới rồi reload Menu trước khi khóa được nhả.
- Empty: đặt `Product.active=false` trong QA, reload; khôi phục `active=true` sau khi chụp.
- Error: `node scripts/qa-stack.cjs stop-api`, reload. Sau đó `node scripts/qa-stack.cjs start-api`, nhấn **Thử lại**.
- Kết thúc: `npm run qa:down`.

```powershell
'BEGIN; LOCK TABLE "Product" IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(25); COMMIT;' | node scripts/qa-stack.cjs sql
'UPDATE "Product" SET active=false;' | node scripts/qa-stack.cjs sql
'UPDATE "Product" SET active=true;' | node scripts/qa-stack.cjs sql
```

Kiểm thử tổng thể: **385 backend + 76 frontend**, không skip; lint, contract/types và Docker build đạt. Xem [biên bản nghiệm thu](../final/README.md). Thay đổi nghiệm thu không đổi API/schema/env của Menu. PR triển khai: [#28](https://github.com/nguyen213123/BrewLite-v2/pull/28).
