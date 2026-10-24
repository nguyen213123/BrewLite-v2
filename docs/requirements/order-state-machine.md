# Dịch vụ chuyển trạng thái đơn hàng (Issue #8)

Tài liệu này mô tả cách `OrderTransactionsService` (`backend/src/modules/orders/order-transactions.service.ts`) hiện thực State Machine trong [business-rules.md](business-rules.md) §4. Nó **không đổi** ERD, API Contract hay bảng trạng thái; chỉ ghi rõ hành vi gọi lặp, chuyển đồng thời và thử lại.

## Nguyên tắc: một nơi duy nhất đổi `Order.status`

Mọi thay đổi trạng thái đi qua `OrderTransactionsPort`:

| Hàm | Dùng cho | Người gọi |
| --- | --- | --- |
| `transition(tx, { orderId, actorUserId, expectedVersion, toStatus })` | PENDING→PAID, PENDING→PAYMENT_FAILED, hủy đơn, PAID→PREPARING→READY→COMPLETED | Payment (TV5), `OrdersService.cancel`, `OrdersService.transition` (STAFF) |
| `prepareRetry(tx, order)` | PAYMENT_FAILED→PENDING (thử lại thanh toán) | Payment (TV5) |
| `loadOwned(tx, userId, orderId)` | Đọc đơn của chính user; đơn của người khác hoặc không tồn tại đều `404 ORDER_NOT_FOUND` | Cancel, Payment |

Module khác **không** được `UPDATE Order.status` trực tiếp. `transition(..., 'PENDING')` bị từ chối (`409 INVALID_ORDER_TRANSITION`); cạnh PAYMENT_FAILED→PENDING chỉ đi qua `prepareRetry` vì nó phải giữ lại kho và lượt ưu đãi nguyên tử.

## Một lần chuyển trạng thái làm gì (trong transaction của người gọi)

1. Đọc đơn. Không có: `404 ORDER_NOT_FOUND`.
2. `version` khác `expectedVersion`: `409 ORDER_VERSION_CONFLICT`.
3. `assertTransition(status hiện tại, toStatus)`: cạnh không có trong bảng thì `409 INVALID_ORDER_TRANSITION`.
4. **Cập nhật có điều kiện**: `UPDATE Order SET status, version = version + 1 WHERE id AND version = expectedVersion AND status = status đã đọc`. Không khớp dòng nào: `409 ORDER_VERSION_CONFLICT`.
5. Hiệu ứng tài nguyên, chỉ chạy sau khi bước 4 thành công:
   - sang `PAID`: `reservationStatus` HELD → CONSUMED (không đổi `stock`, không đổi lượt ưu đãi);
   - sang `PAYMENT_FAILED` hoặc `CANCELLED`: `InventoryPort.release` và `PromotionRulesPort.release`, **chỉ khi** đơn chưa `RELEASED`. PAYMENT_FAILED→CANCELLED vì vậy không trả kho/ưu đãi lần hai;
   - sang `PREPARING`/`READY`/`COMPLETED`: chỉ đổi trạng thái và version.
6. Ghi `OrderEvent(orderId, actorUserId, fromStatus, toStatus, orderVersion = expectedVersion + 1)`. Ràng buộc unique `(orderId, orderVersion)` là lớp bảo vệ thứ hai chống ghi trùng.

Mọi lỗi ném ra làm transaction của người gọi rollback, nên trạng thái, kho, ưu đãi, event, refund và điểm cùng commit hoặc cùng bị hủy.

## Hành vi cần nhớ

**Gọi lặp.** Cùng một `expectedVersion` chỉ áp dụng một lần: lần sau thấy version đã tăng nên nhận `ORDER_VERSION_CONFLICT`. Ngoại lệ duy nhất theo hợp đồng: hủy đơn đã `CANCELLED` với `expectedVersion` bằng version hiện tại trả `200` và không có hiệu ứng mới (không release, refund, đảo điểm hay event thứ hai). Hủy với version cũ trả `409`. Thanh toán lặp được lớp Idempotency-Key của TV5 chặn, không dựa vào cạnh này.

**Chuyển đồng thời.** Hai request cùng đọc version N. Câu `UPDATE` thứ nhất thắng; câu thứ hai chờ commit, đánh giá lại điều kiện trên dòng mới (READ COMMITTED), khớp 0 dòng và bị `ORDER_VERSION_CONFLICT` **trước khi** chạy bất kỳ hiệu ứng nào. Vì vậy PAID→PREPARING và PAID→CANCELLED đồng thời chỉ có một bên thắng; refund, trả kho và đảo điểm chỉ xảy ra khi hủy thắng.

**Đơn đã PAID không bị đổi thành PAYMENT_FAILED.** Request thất bại đến muộn mang version cũ nên bị `ORDER_VERSION_CONFLICT`; nếu mang version hiện tại thì cạnh PAID→PAYMENT_FAILED không tồn tại nên bị `INVALID_ORDER_TRANSITION`. Đơn không đổi.

**Thử lại sau thất bại (`prepareRetry`).** Chỉ cho đơn `PAYMENT_FAILED`. Cập nhật có điều kiện (`status = PAYMENT_FAILED`, `reservationStatus = RELEASED`, `version`) được thực hiện **trước**, nên nhiều lần thử đồng thời xếp hàng trên dòng đơn và chỉ một lần giữ được kho. Sau đó kiểm tra lại mã ưu đãi (`price`, giữ nguyên discount và total đã lưu) rồi `reserve` lượt ưu đãi và kho. Không giữ lại được (`OUT_OF_STOCK`, `PROMOTION_*`) thì rollback toàn bộ: đơn vẫn `PAYMENT_FAILED`/`RELEASED`, không có event, không tồn kho nào bị giữ. Giá không được tính lại.

**Hủy đơn (`POST /orders/{id}/cancel`).** Dùng cùng `transition`. Riêng đơn `PAID`, trong cùng transaction: payment `SUCCEEDED` → `REFUNDED` (mock refund) và `LoyaltyTransactionsPort.reverse` đảo điểm. Không hủy được PREPARING, READY, COMPLETED (`409 INVALID_ORDER_TRANSITION`).

**Cập nhật pha chế (`PATCH /orders/{id}/status`).** Chỉ STAFF (guard ở controller). Chỉ nhận PREPARING, READY, COMPLETED, đúng thứ tự, không bỏ bước.

## Điểm phối hợp với module khác

- **TV5 (Payment):** gọi `transition(PAID | PAYMENT_FAILED)` với `expectedVersion` lấy từ đơn vừa đọc, và `prepareRetry` cho lần thử lại; không tự cập nhật `Order.status`. Việc cộng điểm (`LoyaltyTransactionsPort.earn`) vẫn do luồng payment gọi sau khi `transition(PAID)` thành công.
- **TV4 (Loyalty):** `reverse(tx, order)` được gọi khi hủy đơn PAID và phải tự chống đảo lặp bằng unique `(orderId, REVERSE)`.
- **Refund mock:** hiện `OrdersService.cancel` cập nhật `Payment.status` SUCCEEDED → REFUNDED trực tiếp vì chưa có port refund. Nếu TV5 muốn sở hữu bước này, cần thêm một port riêng qua PR hợp đồng.

## Kiểm thử

- `backend/test/order-transitions.e2e-spec.ts` (không cần database): toàn bộ 49 cặp trạng thái (cạnh hợp lệ được áp dụng, cạnh cấm bị từ chối, DB không đổi), version cũ, cuộc đua giả lập, hiệu ứng kho/ưu đãi theo từng cạnh, `prepareRetry`, hủy các trạng thái, hủy lặp, STAFF.
- `backend/test/order-transitions.integration-spec.ts` (PostgreSQL thật, `RUN_DB_TESTS=1`): 10 request PENDING→PAID cùng version, PAID→PREPARING tranh PAID→CANCELLED, hủy và PAYMENT_FAILED lặp đồng thời (kho trả một lần), thử lại đồng thời (kho giữ một lần), thử lại thất bại rollback.

```powershell
docker compose up -d db
npm --prefix backend run prisma:deploy
$env:DATABASE_URL = "<giá trị trong backend/.env>"
$env:RUN_DB_TESTS = "1"
npm --prefix backend test -- order-transitions.integration
```

## Kết quả chạy trên PostgreSQL thật

Chạy ngày 24/10/2026 với database PostgreSQL của `docker compose` (service `db`), 2 migration đã áp dụng, lệnh `npm --prefix backend test -- order-transitions.integration` với `RUN_DB_TESTS=1`. Lần chạy dùng branch tạm ghép code của Issue #8 với `InventoryService` thật của PR #9 (#25), vì test này gọi `reserve`/`release` thật. Kết quả: 1 suite, 7/7 test đạt.

| Kịch bản | Kết quả kiểm chứng |
| --- | --- |
| 10 request PENDING → PAID đồng thời, cùng `expectedVersion` | Đúng 1 request thành công, các request còn lại `ORDER_VERSION_CONFLICT`; đơn `PAID`/`CONSUMED`, version 1, đúng 1 OrderEvent |
| PAID → PREPARING tranh PAID → CANCELLED | Đúng 1 bên thắng, version 2, đúng 1 OrderEvent; tồn kho tăng lại đúng số ly của đơn chỉ khi hủy thắng |
| 5 lần hủy đồng thời một đơn PENDING | Đúng 1 lần thành công (`CANCELLED`/`RELEASED`, version 1), tồn kho cộng lại đúng một lần, đúng 1 OrderEvent |
| Hủy lại đơn đã `CANCELLED` với version hiện tại | Trả đơn cũ, tồn kho và OrderEvent không đổi |
| 5 lần PENDING → PAYMENT_FAILED đồng thời | Đúng 1 lần thành công, tồn kho cộng lại đúng một lần |
| 3 lần thử lại đơn PAYMENT_FAILED đồng thời | Đúng 1 lần thành công (`PENDING`/`HELD`, version 2), tồn kho chỉ bị giữ một lần, đúng 1 OrderEvent |
| Thử lại khi không đủ tồn kho | `OUT_OF_STOCK`; đơn vẫn `PAYMENT_FAILED`/`RELEASED`, tồn kho nguyên vẹn, không có OrderEvent (rollback) |

Phạm vi: các test trên kiểm chứng dịch vụ chuyển trạng thái, hủy đơn và thử lại ở mức module `orders` với tồn kho thật. Chưa gồm luồng thanh toán của TV5 (gọi `transition`/`prepareRetry`), mock refund và đảo điểm với `LoyaltyModule` thật; cần chạy lại test tích hợp khi các phần đó được merge.
