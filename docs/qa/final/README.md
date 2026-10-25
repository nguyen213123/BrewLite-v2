# Nghiệm thu BrewLite

Ngày: **26/10/2026**, Asia/Saigon. Baseline được kiểm thử: `0eed8fe258c5266f73e40ee3c47640cb4f00a22b` (main sau PR #32, có PR #35). Các ảnh là thao tác trên ứng dụng production Docker, API NestJS và PostgreSQL 17 thật trong stack QA riêng. Gateway thanh toán Ví/Thẻ vẫn là mock theo đề; không có giao dịch tiền thật.

## Kết quả tự động và hạ tầng

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run test:db` | 22 suite backend, **385 test đạt**; frontend **76 test đạt**; không skip/fail; database test tạm được dọn |
| `npm run lint` | Backend và frontend đạt |
| `npm run docs:check`, `npm run api:check` | Contract và generated types đạt |
| `npm run qa:up` | Build production frontend/backend, khởi tạo PostgreSQL sạch, migrate, seed và readiness đạt |
| `node --check scripts/qa-stack.cjs`, `node --check scripts/benchmark-api.cjs` | Đạt |
| `npm run qa:benchmark` | 970 request đo, tất cả nhóm endpoint có p95 < 500 ms trong môi trường local này |

`npm test` mặc định bỏ qua DB integration; kết quả 385/76 ở đây lấy từ `test:db`, không lấy số test mặc định làm bằng chứng database. CI trên PR bàn giao cần đạt ở commit cuối cùng trước khi merge.

## Ma trận luồng

| Phạm vi | Bằng chứng và kết quả |
| --- | --- |
| #2–4 Catalog/Menu/detail | 17 sản phẩm thật, hai trang, đúng ID; desktop/mobile/loading/empty/error/retry: [hồ sơ Menu](../issue-4/README.md) |
| #3/#5 Size/topping/cart | M + Kem ×2 = 120.000đ; [chi tiết](images/product-mobile.png), [giỏ](images/cart-mobile.png), [giỏ rỗng](images/cart-empty-mobile.png); cart persistence/merge/quantity có test frontend |
| #6 Auth/quyền | Đăng ký/đăng nhập trên UI; test JWT, 401/403/404, cô lập chủ đơn, che lỗi trong auth/API/history suites |
| #7/#13/#14 Quote/checkout/promotion | BADCODE có lỗi rõ; SAVE10 giảm 12.000 trên 120.000, tổng 108.000: [mã sai](images/promotion-invalid-mobile.png), [quote](images/quote-mobile.png) |
| #10/#11 Thanh toán FAIL → reload → retry SUCCESS | Cùng đơn, FAIL giữ giỏ/0 điểm; SUCCESS 108.000 xóa đúng giỏ/10 điểm: [FAIL](images/payment-failed-mobile.png), [PAID](images/payment-paid-mobile.png) |
| Giá thay đổi khi tạo đơn | Giá M từ 50.000 → 60.000 trong QA: chặn pay, reload vẫn chặn, phải xác nhận lại; [mobile](images/price-confirmation-mobile.png), [desktop](images/price-confirmation-desktop.png), [PAID sau xác nhận](images/payment-paid-desktop.png) |
| #8/#12/#15 Hủy PAID/lịch sử/điểm | Hủy trước pha chế → CANCELLED, hoàn hiệu ứng, 0 điểm; [hủy](images/cancelled-mobile.png), [ledger +10/−10](images/loyalty-reversal-mobile.png), [lịch sử](images/history-desktop.png) |
| #8 State Machine | Test mọi cạnh hợp lệ/bị cấm, expectedVersion, terminal states, STAFF guard, audit, late payment, chuyển đồng thời trong order-state/order-transitions/payments/checkout suites |
| #9 Tranh tồn kho | inventory.integration và checkout.integration: tranh đơn, rollback, stock không âm, trả kho đúng một lần |
| #11 Idempotency | DB integration: cùng key/cùng payload replay, khác payload 409, hai request đồng thời, retry/timeout không lặp hiệu ứng |
| #14 Khuyến mãi | promotion-rules và checkout.integration: FIXED/PERCENT/floor/min/max, thời hạn/giới hạn, HELD/CONSUMED/release/retry, cạnh tranh và rollback |
| #15 Loyalty | loyalty/checkout.integration: EARN/REVERSE một lần, replay/hủy không nhân đôi, không dùng điểm để giảm tiền trong MVP |

Các ca cạnh tranh, STAFF và rollback nêu trên được xác minh bằng test HTTP/DB, không phải tất cả đều có thao tác UI riêng. Kịch bản trình diễn: [demo.md](demo.md).

## Đo API

Chi tiết từng endpoint, p50/p95/max, số mẫu và thông tin máy: [latency.json](latency.json). Thời điểm đo `2026-10-25T17:16:18Z` = 00:16:18 ngày 26/10 tại Việt Nam. Máy Windows, Node 24.21.0, i7-1265U, RAM 15 GiB; backend production Docker, PostgreSQL 17 tmpfs; 17 sản phẩm/51 size/5 topping/85 liên kết/3 mã.

| Nhóm | Mẫu/mức đồng thời | p95 (ms) |
| --- | --- | --- |
| 9 endpoint GET/quote/validate | 50 mỗi endpoint ở c=1 và c=5 | 3,94–26,32 |
| Đăng nhập | 10, c=1 | 235,44 |
| Tạo đơn | 20, c=1 | 16,15 |
| Thanh toán | 20, c=1 | 18,21 |
| Hủy | 20, c=1 | 17,25 |

Đo HTTP round trip đến khi parse JSON, bỏ warm-up; 900+10+60=970 request đo. Không đo register/STAFF/lock timeout. Đây là kết quả dataset nhỏ local, không suy ra SLA cho triển khai public hoặc tải lớn. Test lock timeout/tranh chấp được đánh giá riêng về tính đúng đắn.

## Chạy lại và giới hạn bàn giao

```powershell
npm ci
npm run setup
npm run test:db
npm run lint
npm run docs:check
npm run api:check
npm run qa:up
npm run qa:benchmark
npm run qa:down
```

`test:db` cần PostgreSQL localhost có quyền tạo DB; xem README. `qa:up` dùng cổng 3400/3401 và DB tmpfs riêng, tự sinh JWT secret test, không đọc env hay volume phát triển. Seed chỉ dành cho dữ liệu QA có thể đặt lại; benchmark tạo tài khoản/đơn giả rồi hủy đơn. `qa:down` chỉ dọn stack QA của workspace này.

Chưa phát hiện lỗi chặn trong phạm vi MVP qua các kiểm tra trên. Các giới hạn đã công bố: gateway mock; PENDING không tự hết hạn; checkout không đồng bộ nhiều tab; không có trang quản trị; chưa nghiệm thu triển khai public. Đây không phải những chức năng được xác nhận đã làm.

**Issue #16 vẫn chờ xác nhận con người:** người dùng trả lời “chưa có” khi hỏi thành viên khác clone/chạy README và thông tin sprint/demo thực tế. [Checklist ký nhận](human-signoff.md) giữ các mục này chưa đánh dấu. [Hồ sơ planning/review/retro](../../sprints/acceptance-2026-10-26/planning.md) ghi nhận đợt nghiệm thu, không dựng lại lịch họp chưa có dữ liệu. Không tạo approval thay thành viên hoặc tự nhận đã review bởi người khác.
