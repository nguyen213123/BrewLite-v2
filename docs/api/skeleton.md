# Bộ khung API để phát triển song song

Khung này kế thừa baseline issue #1/PR #17 đã merge. Tài liệu giữ kiến trúc giao tiếp module; main hiện đã có nghiệp vụ thật. Theo quy ước nhóm, thành viên phát triển trên nhánh riêng và gửi PR; trưởng nhóm review và quyết định tích hợp. Trạng thái/bằng chứng cập nhật xem [nghiệm thu](../qa/final/README.md).

## Có gì chạy thật?

- Module NestJS, routing đủ 17 operation trong OpenAPI, DTO validation/normalization, phân trang, UUID/header, error envelope và CORS.
- Prisma client/schema nền theo 13 bảng nghiệp vụ trong ERD, giữ SystemCheck và migration cũ; migration bổ sung `20261022010000_api_baseline` thêm FK/unique/index/CHECK. Không có seed nghiệp vụ trong khung này.
- TypeScript response/request type sinh từ OpenAPI cho cả backend và frontend.
- Guard bắt buộc Bearer ở endpoint bảo vệ; CurrentUser chỉ từ IdentityPort; StaffGuard kiểm tra role đã được xác minh.
- UnitOfWork dùng một Prisma transaction client, timeout/lock timeout theo baseline; helper assertTransition chứa đầy đủ cạnh được phép.

Catalog, JWT, order, inventory, promotion, loyalty và idempotency đã được hiện thực. Thiếu/sai Bearer trả 401; role/quyền sở hữu lấy từ JWT đã xác minh và user trong database. Không có dev token, header userId/role hay chế độ bỏ qua guard. Gateway WALLET/CARD mô phỏng; đơn/giá/kho/ledger được xử lý trên PostgreSQL, không fallback success khi API lỗi.

Các kiểm thử HTTP override port bằng fixture chỉ nằm trong backend/test. Chúng chứng minh wiring/validation/response contract, không thay thế integration test nghiệp vụ của các thành viên.

## Vị trí từng người làm

| Người | Thư mục được giao | Điểm tích hợp |
| --- | --- | --- |
| TV1 | `backend/src/modules/products/`, `promotions/` | ProductsPort, CatalogPricingPort, PromotionsPort, PromotionRulesPort; frontend detail theo issue #3 |
| TV2 | Frontend menu/cart/checkout, `frontend/src/lib/contracts/api.generated.ts` dùng để import type | CartItem/OrderRequest/Quote/Order/PaymentResult; không sửa file type sinh tự động |
| TV3 | `backend/src/modules/orders/`, `inventory/` | OrdersPort, OrderReadPort, OrderTransactionsPort, InventoryPort; assertTransition và Prisma schema nền đã có |
| TV4 | `backend/src/modules/auth/`, `order-history/`, `loyalty/` | AuthPort, IdentityPort, guards, LoyaltyPort/LoyaltyTransactionsPort; controller GET /orders/me và /orders/:id cùng file, /me đứng trước |
| TV5 | `backend/src/modules/payments/`, `idempotency/` | PaymentsPort, MockPaymentGatewayPort, IdempotencyPort; không tạo State Machine thứ hai |

Mỗi module có controller (nếu có endpoint), DTO, service và Nest provider aliases. Giữ chữ ký public khi thay thân hàm; không tạo API hoặc enum trạng thái riêng ngoài contract đã review. Bắt đầu bằng nhánh riêng từ main mới nhất; không mang lại service stub hoặc implementation cũ khi giải quyết xung đột.

## Interface và quy tắc transaction

`backend/src/common/contracts/ports.ts` là nơi duy nhất định nghĩa điểm nối module. Controller chỉ gọi port; module khai báo `useExisting` để không tạo hai instance dịch vụ. Phụ thuộc đi theo port được module chủ export; không import service nội bộ của người khác.

- **TV1 → TV3:** CatalogPricingPort.resolve(tx, items) trả snapshot QuoteItem; PromotionRulesPort.price/reserve/release(tx,...) dùng chính tx caller truyền vào.
- **TV3 → TV4:** OrderReadPort.listMine/findMine nhận userId đã xác minh và tự lọc quyền sở hữu. Controller lịch sử không tự lấy mọi đơn rồi lọc phía client.
- **TV3 ↔ TV5:** IdempotencyPort.execute<T>(input, work) bao toàn bộ transaction, callback work nhận Tx. TV3 dùng scope CREATE_ORDER; TV5 dùng PAY_ORDER. Key PROCESSING, nghiệp vụ và snapshot COMPLETED cùng commit/rollback; replay hoàn tất trả trước kiểm tra lại trạng thái nghiệp vụ.
- **TV5 → TV3:** OrderTransactionsPort.loadOwned/prepareRetry/transition và InventoryPort dùng cùng tx. Helper assertTransition kiểm tra cạnh; service dùng conditional write/version, OrderEvent và hiệu ứng trong transaction.
- **TV5 → TV4:** LoyaltyTransactionsPort.earn/reverse(tx, storedOrder) cùng commit hoặc rollback với payment/cancel.
- UnitOfWork.run(work) mở transaction ReadCommitted, maxWait=3s/timeout=5s và SET LOCAL lock_timeout=3s. TV3/TV5 đặt retry toàn bộ callback ở ngoài, không retry riêng một câu UPDATE. Không gọi cổng thanh toán mạng thật trong callback.
- DTO đã chuẩn hóa email, mã promo và UUID; thành viên vẫn phải gộp/sort cart, canonical hash, kiểm tra catalog/tồn/giá/khuyến mãi theo business-rules.md. Validation DTO không bảo đảm nghiệp vụ đã đúng.
- Auth validate JWT_SECRET tối thiểu 32 ký tự khi startup, áp dụng auth-policy.ts. Không dùng secret mặc định trong runtime; secret của CI/QA chỉ dùng trong môi trường thử riêng.

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

CI bật RUN_DB_TESTS=1 trên PostgreSQL tạm của job sau khi migrate. Ở local dùng wrapper dưới đây: nó tạo database thử riêng, migrate, chạy toàn bộ suite rồi xóa, kể cả khi test thất bại. Không trỏ các suite vào database phát triển vì một số test tạo fixture thật.

```powershell
docker compose up -d db
npm run test:db
```

Các suite tích hợp có **ghi dữ liệu mẫu thật** (tồn kho, đơn hàng) không chạy trên database đang dùng mà tự tạo database tạm `brewlite_test_<ngẫu nhiên>` qua `backend/test/support/temp-database.ts` (áp dụng migration, xóa trong `afterAll` kể cả khi test lỗi). Khi đó `DATABASE_URL` chỉ là máy chủ PostgreSQL cục bộ để chạy `CREATE/DROP DATABASE`, role cần quyền `CREATEDB`. Xem `docs/requirements/inventory-concurrency.md` để biết lệnh chạy và cách dọn database tạm còn sót.

Database tests hiện bao gồm schema/constraints, deadlock, tranh tồn, quota mã, State Machine, idempotency và checkout HTTP với các module thật. Phân biệt suite mock port với suite nghiệp vụ tích hợp khi nêu bằng chứng; xem [ma trận nghiệm thu](../qa/final/README.md).

## Quy trình thay đổi và nghiệm thu

1. Trưởng nhóm review/merge baseline tài liệu, sau đó khung API/migration; mọi thành viên cập nhật main.
2. Mỗi issue có nhánh và PR riêng. Sửa đúng thư mục; thay port/DTO/OpenAPI/ERD phải phối hợp chủ module.
3. Viết test của nghiệp vụ thật, không chỉ override mock; cập nhật README và bằng chứng chạy.
4. Gửi PR `Refs #n` nếu mới một phần; chỉ dùng `Closes #n` khi đủ toàn bộ tiêu chí. Trưởng nhóm quyết định merge.
