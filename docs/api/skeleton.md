# Bộ khung API để phát triển song song

Khung này kế thừa baseline issue #1/PR #17. PR #17 cần được trưởng nhóm review/merge trước khi đưa khung này vào main. Tài liệu trên nhánh này là phần tích hợp đang chờ review. Theo quy ước nhóm, thành viên phát triển trên nhánh riêng và gửi PR; trưởng nhóm review và quyết định tích hợp.

## Có gì chạy thật?

- Module NestJS, routing đủ 17 operation trong OpenAPI, DTO validation/normalization, phân trang, UUID/header, error envelope và CORS.
- Prisma client/schema nền theo 13 bảng nghiệp vụ trong ERD, giữ SystemCheck và migration cũ; migration bổ sung `20261022010000_api_baseline` thêm FK/unique/index/CHECK. Không có seed nghiệp vụ trong khung này.
- TypeScript response/request type sinh từ OpenAPI cho cả backend và frontend.
- Guard bắt buộc Bearer ở endpoint bảo vệ; CurrentUser chỉ từ IdentityPort; StaffGuard kiểm tra role đã được xác minh.
- UnitOfWork dùng một Prisma transaction client, timeout/lock timeout theo baseline; helper assertTransition chứa đầy đủ cạnh được phép.

Service nghiệp vụ hiện trả **501 FEATURE_NOT_IMPLEMENTED**. Không có đơn hàng/giá/tài khoản/thanh toán giả trả success trong runtime. AuthService.verifyAccessToken cũng là stub: thiếu Bearer trả 401, có Bearer vẫn trả 501 cho đến khi TV4 hiện thực xác minh JWT và nạp user DB. Không có dev token, header userId/role, hay chế độ bỏ qua guard.

Các kiểm thử HTTP override port bằng fixture chỉ nằm trong backend/test. Chúng chứng minh wiring/validation/response contract, không thay thế integration test nghiệp vụ của các thành viên.

## Vị trí từng người làm

| Người | Thư mục được giao | Điểm tích hợp |
| --- | --- | --- |
| TV1 | `backend/src/modules/products/`, `promotions/` | ProductsPort, CatalogPricingPort, PromotionsPort, PromotionRulesPort; frontend detail theo issue #3 |
| TV2 | Frontend menu/cart/checkout, `frontend/src/lib/contracts/api.generated.ts` dùng để import type | CartItem/OrderRequest/Quote/Order/PaymentResult; không sửa file type sinh tự động |
| TV3 | `backend/src/modules/orders/`, `inventory/` | OrdersPort, OrderReadPort, OrderTransactionsPort, InventoryPort; assertTransition và Prisma schema nền đã có |
| TV4 | `backend/src/modules/auth/`, `order-history/`, `loyalty/` | AuthPort, IdentityPort, guards, LoyaltyPort/LoyaltyTransactionsPort; controller GET /orders/me và /orders/:id cùng file, /me đứng trước |
| TV5 | `backend/src/modules/payments/`, `idempotency/` | PaymentsPort, MockPaymentGatewayPort, IdempotencyPort; không tạo State Machine thứ hai |

Mỗi module đã có controller (nếu có endpoint), DTO, service stub và Nest module provider aliases. Giữ chữ ký public khi thay thân hàm; không tạo API hoặc enum trạng thái mới riêng cho module. Bắt đầu bằng nhánh riêng từ main mới nhất sau khi trưởng nhóm merge các PR nền. Nếu main chưa có baseline, có thể đọc/chuẩn bị theo nhánh PR nhưng không coi đó là chuẩn đã duyệt.

## Interface và quy tắc transaction

`backend/src/common/contracts/ports.ts` là nơi duy nhất định nghĩa điểm nối module. Controller chỉ gọi port; module khai báo `useExisting` để không tạo hai instance dịch vụ. Phụ thuộc đi theo port được module chủ export; không import service nội bộ của người khác.

- **TV1 → TV3:** CatalogPricingPort.resolve(tx, items) trả snapshot QuoteItem; PromotionRulesPort.price/reserve/release(tx,...) dùng chính tx caller truyền vào.
- **TV3 → TV4:** OrderReadPort.listMine/findMine nhận userId đã xác minh và tự lọc quyền sở hữu. Controller lịch sử không tự lấy mọi đơn rồi lọc phía client.
- **TV3 ↔ TV5:** IdempotencyPort.execute<T>(input, work) bao toàn bộ transaction, callback work nhận Tx. TV3 dùng scope CREATE_ORDER; TV5 dùng PAY_ORDER. Stub wrapper hiện cố ý không gọi callback, để không tạo thao tác ngoài cơ chế chống lặp.
- **TV5 → TV3:** OrderTransactionsPort.loadOwned/prepareRetry/transition và InventoryPort dùng cùng tx. Helper assertTransition chỉ kiểm tra cạnh; TV3 vẫn phải triển khai conditional write/version, audit và hiệu ứng trong transaction.
- **TV5 → TV4:** LoyaltyTransactionsPort.earn/reverse(tx, storedOrder) cùng commit hoặc rollback với payment/cancel.
- UnitOfWork.run(work) mở transaction ReadCommitted, maxWait=3s/timeout=5s và SET LOCAL lock_timeout=3s. TV3/TV5 đặt retry toàn bộ callback ở ngoài, không retry riêng một câu UPDATE. Không gọi cổng thanh toán mạng thật trong callback.
- DTO đã chuẩn hóa email, mã promo và UUID; thành viên vẫn phải gộp/sort cart, canonical hash, kiểm tra catalog/tồn/giá/khuyến mãi theo business-rules.md. Validation DTO không bảo đảm nghiệp vụ đã đúng.
- Khung chưa dùng JWT_SECRET; khi TV4 thực hiện auth phải validate cấu hình fail startup và áp dụng auth-policy.ts. Không dùng giá trị mặc định làm secret.

## Lệnh làm việc

```powershell
npm ci
npm run setup
npm run db:generate
# Docker Desktop/PostgreSQL cần chạy trước deploy:
docker compose up -d db
npm --prefix backend run prisma:deploy
npm run dev
```

Không ghi đè env cá nhân. Nếu mới clone, copy env example theo README. Sau khi thêm migration nền, hãy dùng migrate deploy; không sửa migration cũ hoặc reset database dùng chung.

```powershell
npm run api:types     # Sau khi cập nhật OpenAPI có review
npm run api:check     # Phát hiện generated types bị chỉnh hoặc lệch contract
npm run docs:check    # OpenAPI + fixture
npm run docs:schema   # Prisma reference
npm run lint
npm test
npm run build
```

Schema runtime và schema tham chiếu phải có cùng enum/model nghiệp vụ; runtime chỉ thêm generator và SystemCheck. SQL CHECK/partial unique không được Prisma DSL biểu diễn đầy đủ, giữ chúng trong migration và kiểm thử DB. Không tạo migration trùng việc baseline này ở các nhánh feature khác.

## Kiểm tra DB riêng

CI bật RUN_DB_TESTS=1 trên PostgreSQL tạm của job sau khi migrate. Muốn chạy local, chọn database kiểm thử đã migrate rồi thiết lập DATABASE_URL và RUN_DB_TESTS trong terminal; các ca tạo fixture trong transaction đều chủ đích rollback, không truncate/reset dữ liệu.

```powershell
$env:RUN_DB_TESTS = "1"
# DATABASE_URL phải trỏ tới database kiểm thử đã migrate
npm --prefix backend test
Remove-Item Env:RUN_DB_TESTS
```

Database tests kiểm tra bảng, CHECK và unique nền; chưa chứng minh chống vượt tồn hoặc idempotency nghiệp vụ. TV3/TV5 bổ sung test tranh chấp thật khi hoàn thiện service. Không đóng các issue chức năng chỉ vì bộ khung build/test đạt.

## Quy trình thay đổi và nghiệm thu

1. Trưởng nhóm review/merge baseline tài liệu, sau đó khung API/migration; mọi thành viên cập nhật main.
2. Mỗi issue có nhánh và PR riêng. Sửa đúng thư mục; thay port/DTO/OpenAPI/ERD phải phối hợp chủ module.
3. Viết test của nghiệp vụ thật, không chỉ override mock; cập nhật README và bằng chứng chạy.
4. Gửi PR `Refs #n` nếu mới một phần; chỉ dùng `Closes #n` khi đủ toàn bộ tiêu chí. Trưởng nhóm quyết định merge.
