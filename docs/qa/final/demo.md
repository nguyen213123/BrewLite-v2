# Kịch bản demo nghiệm thu

Dùng QA có thể đặt lại: `npm run qa:up`, mở <http://localhost:3400>. Đăng ký tài khoản giả mới; không dùng email/mật khẩu hoặc phương thức thanh toán thật. Kết thúc `npm run qa:down`.

1. **TV1 + TV2:** Menu desktop/mobile, trang 2, chọn Cappuccino; size M + Kem, số lượng 2 → 120.000đ. Thêm giỏ, reload, chỉnh số lượng và xóa; thêm lại cấu hình trên.
2. **TV4:** Đăng ký/đăng nhập; giỏ vẫn còn. Người không đăng nhập không được gọi API đơn bảo vệ; người khác không đọc được đơn ngoài quyền (xem test auth/history).
3. **TV1 + TV2:** BADCODE báo lỗi; SAVE10 → subtotal 120.000, discount 12.000, total 108.000; hiển thị quote từ API.
4. **TV3 + TV5:** Tạo đơn PENDING, chọn CARD/FAIL → PAYMENT_FAILED, giữ giỏ, 0 điểm. Reload rồi thử SUCCESS trên cùng đơn với key mới → PAID, giỏ hết các dòng đã mua, 10 điểm.
5. **TV4:** Mở lịch sử/chi tiết đơn, reload. Hủy PAID trước pha chế → CANCELLED, điểm về 0; ledger có +10/−10. Không thanh toán/hủy lặp tạo hiệu ứng thêm.
6. **TV2:** Đơn mới, M không topping ×1 có quote 50.000; trong **QA** cập nhật giá M thành 60.000 bằng SQL dưới đây rồi tạo đơn. UI yêu cầu xác nhận lại và khóa pay cả sau reload; chỉ trả tiền sau khi người dùng xác nhận giá mới. Hủy đơn sau demo.
7. **TV3 + TV5:** Trình bày kết quả test DB cho State Machine, tranh tồn kho, concurrent replay, khuyến mãi/điểm đúng một lần. STAFF dùng endpoint theo OpenAPI; không giả định có màn hình quầy pha chế.
8. **Điều phối:** Trình bày CI, ma trận, latency và phần còn chờ người xác nhận trong `human-signoff.md`.

```powershell
'UPDATE "ProductSize" SET price=60000 WHERE "productId"=''11111111-1111-4111-8111-111111111111'' AND size=''M'';' | node scripts/qa-stack.cjs sql
```

Đổi giá chỉ trên QA, không DB phát triển. Khôi phục bằng `node scripts/qa-stack.cjs seed` trước khi benchmark; seed đặt lại dữ liệu mẫu nên kết thúc các đơn demo trước. Loading/empty/error/retry xem [hướng dẫn Menu](../issue-4/README.md).
