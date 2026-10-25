# Chiến lược tồn kho và xử lý đồng thời (Issue #9)

Tài liệu này giải thích cách `InventoryService` (`backend/src/modules/inventory/`) giữ, trả tồn kho và chống bán vượt tồn. Nó **không đổi** ERD, API Contract hay quy tắc trong [business-rules.md](business-rules.md) §5; chỉ ghi lại cách hiện thực.

## Đơn vị tồn kho

`Product.stock` là số ly còn bán được, dùng chung cho mọi size và topping. Mỗi `qty` trong đơn tiêu thụ đúng một ly. Không có kho riêng cho topping hay nguyên liệu. Cột `stock` có CHECK `>= 0` ở mức database làm lớp bảo vệ cuối cùng.

## Vòng đời giữ chỗ (`Order.reservationStatus`)

| Thời điểm | Hiệu ứng lên tồn kho | Ai thực hiện |
| --- | --- | --- |
| Tạo đơn PENDING | `reserve`: trừ `stock`, đơn ở `HELD` | `InventoryPort.reserve` gọi trong transaction tạo đơn (#7) |
| PENDING → PAID | Không đổi `stock`; `HELD` → `CONSUMED` | Dịch vụ chuyển trạng thái (#8) |
| PENDING → PAYMENT_FAILED, hủy đơn | `release`: cộng lại `stock`, `HELD` → `RELEASED` | `InventoryPort.release` |
| PAID → CANCELLED (trước PREPARING) | `release`: cộng lại `stock`, `CONSUMED` → `RELEASED` | `InventoryPort.release` |
| PAYMENT_FAILED → PENDING (thử lại) | `reserve` lại, `RELEASED` → `HELD`, cùng một transaction | Dịch vụ chuyển trạng thái (#8) gọi `reserve` |
| PAYMENT_FAILED → CANCELLED | Không trả lần hai (đã `RELEASED`) | `release` là no-op |

## `reserve`: transaction + optimistic locking

`reserve(tx, items)` luôn chạy **bên trong transaction của người gọi** (tạo đơn, hoặc thử lại thanh toán). Nó không tự mở transaction, nên mọi thay đổi tồn kho nằm cùng một lần commit/rollback với đơn hàng, lượt khuyến mãi và idempotency key.

1. **Gộp qty theo `productId`** trước khi kiểm tra. Hai dòng cùng sản phẩm (khác size/topping) được cộng lại; nếu không, mỗi dòng đều "đủ hàng" riêng lẻ nhưng tổng thì vượt tồn.
2. **Duyệt sản phẩm theo `productId` tăng dần.** Mọi request lấy khóa hàng theo cùng một thứ tự nên không tạo vòng chờ (deadlock).
3. Với mỗi sản phẩm, tối đa **3 lần thử**:
   - Đọc `stock`, `version`, `active`.
   - Không tồn tại hoặc ngừng bán: `404 PRODUCT_NOT_FOUND`.
   - `stock < qty`: `409 OUT_OF_STOCK`.
   - Cập nhật có điều kiện, nguyên tử trong một câu lệnh:
     `UPDATE Product SET stock = stock - qty, version = version + 1 WHERE id = ? AND version = ? AND stock >= qty`.
   - `count = 1`: thành công. `count = 0`: người khác vừa đổi dòng này, đọc lại và thử tiếp.
4. Hết 3 lần vẫn thua cuộc đua: `409 STOCK_CONFLICT` (client được phép gửi lại với cùng Idempotency-Key). Thiếu hàng thật luôn trả `OUT_OF_STOCK`, không bị che bởi `STOCK_CONFLICT`.
5. Mọi lỗi ném ra khỏi `reserve` làm transaction của người gọi **rollback toàn bộ**, kể cả các sản phẩm đã trừ trước đó trong cùng đơn. Đơn bị từ chối không để lại đơn dở dang hay tồn kho bị giữ.

### Hai tầng thử lại

Baseline yêu cầu "retry toàn bộ transaction tối đa 3 lần cho xung đột version/deadlock/serialization, đọc lại dữ liệu mỗi lần, hết lượt trả `409 STOCK_CONFLICT`" (business-rules §5). Hiện thực chia theo loại lỗi, vì mỗi loại chỉ thử lại được ở một tầng:

| Loại lỗi | Tầng thử lại | Vì sao |
| --- | --- | --- |
| Xung đột version: `UPDATE ... WHERE version = ?` khớp 0 dòng | Trong `InventoryService.holdProduct`, tối đa 3 lần, đọc lại `stock`/`version` mỗi lần | Ở `READ COMMITTED`, câu `UPDATE` bị từ chối nhẹ nhàng (0 dòng, không có lỗi database), transaction vẫn dùng được và `SELECT` kế tiếp thấy dữ liệu đã commit |
| Deadlock (`40P01`), serialization failure (`40001`), Prisma `P2034` | `UnitOfWork.run`, **chạy lại toàn bộ transaction**, tối đa 3 lần | PostgreSQL đã hủy transaction; không thể thử lại câu lệnh bên trong nó. Mỗi lần là một transaction mới, đọc lại mọi dữ liệu, và các thay đổi của lần bị hủy (kể cả các sản phẩm đã trừ trước đó) đã bị database rollback |

Hết lượt ở một trong hai tầng đều trả `409 STOCK_CONFLICT`; thiếu hàng thật luôn trả `409 OUT_OF_STOCK`. Không thử lại `lock_timeout` (3 giây), transaction timeout (5 giây) và mọi lỗi nghiệp vụ (`ApiError`): chúng được báo ngay (ví dụ `IDEMPOTENCY_IN_PROGRESS` do lớp idempotency xử lý).

Có tới 3 lần chạy callback, nên với người gọi `UnitOfWork.run` có ba ràng buộc:

1. Callback chỉ được thay đổi dữ liệu qua `tx`; không gửi email, gọi dịch vụ ngoài hay giữ trạng thái trong bộ nhớ qua các lần thử.
2. **Phối hợp với idempotency (TV5):** `IdempotencyPort.execute` phải chạy trong `UnitOfWork.run` (không tự mở `$transaction`) và chiếm Idempotency-Key **bên trong** `tx`. Khi một lần thử bị hủy, bản ghi key và mọi tác dụng phụ (kho, lượt ưu đãi, đơn, event) cùng bị rollback, lần thử sau chiếm key lại từ đầu, nên cùng một yêu cầu không bao giờ tạo hiệu ứng hai lần.
3. Hết lượt, client được phép gửi lại với cùng Idempotency-Key.

## `release`: chỉ trả một lần

`release(tx, order)` trước hết chuyển `reservationStatus` từ `HELD`/`CONSUMED` sang `RELEASED` bằng câu cập nhật có điều kiện. Nếu `count = 0` (đã `RELEASED`, do request khác hoặc lần gọi trước) thì **dừng, không cộng tồn kho**. Nếu `count = 1` thì cộng lại `qty` (đã gộp theo sản phẩm, theo thứ tự id tăng dần) và tăng `version`. Vì việc chuyển trạng thái và cộng tồn nằm cùng transaction, hai lần `release` đồng thời chỉ có một lần có hiệu lực. Nhờ vậy thanh toán lỗi lặp, hủy lặp hay request trùng không hoàn kho hai lần.

`release` chỉ đổi `reservationStatus`. `status` và `version` của đơn do dịch vụ chuyển trạng thái (#8) cập nhật.

## Kiểm thử

- `backend/test/inventory-stock.e2e-spec.ts`: logic gộp qty, thứ tự duyệt, thử lại theo version, `OUT_OF_STOCK`/`STOCK_CONFLICT`, `release` đúng một lần (không cần database).
- `backend/test/unit-of-work.e2e-spec.ts` (không cần database; `$transaction` giả có rollback thật): lỗi tạm thời rồi thành công, hết 3 lượt trả `STOCK_CONFLICT`, sản phẩm đã trừ trước đó được rollback, không thử lại `OUT_OF_STOCK`/lock timeout/lỗi thường, bản ghi key idempotency được rollback cùng lần thử bị hủy.
- `backend/test/inventory.integration-spec.ts` (PostgreSQL thật): 10 request cùng tranh `stock = 1`, 20 request tranh `stock = 5`, gộp dòng trùng sản phẩm, rollback nhiều sản phẩm và `release` đồng thời.
- `backend/test/unit-of-work.integration-spec.ts` (PostgreSQL thật): hai transaction khóa hai sản phẩm theo thứ tự ngược nhau để tạo **deadlock thật**; PostgreSQL hủy một bên, `UnitOfWork` chạy lại nó, cả hai cùng commit và mỗi sản phẩm chỉ bị trừ đúng một lần cho mỗi bên.

- `backend/test/orders-create.integration-spec.ts` (PostgreSQL thật): `OrdersService.create`, `InventoryService`, `OrderTransactionsService` và `UnitOfWork` thật (chỉ catalog, khuyến mãi và lớp idempotency của module khác được thay bằng bản tối thiểu). 10 đơn tranh `stock = 1`, 20 đơn tranh `stock = 5`, hai đơn 2 ly tranh `stock = 3`, đơn bị từ chối không để lại đơn hay tồn kho bị giữ, và tạo rồi hủy trả đúng số ly đã giữ.

Các suite PostgreSQL tự tạo một database tạm `brewlite_test_<ngẫu nhiên>` (áp dụng đủ migration bằng `prisma migrate deploy`), ghi toàn bộ dữ liệu mẫu vào đó và xóa nó trong `afterAll`, kể cả khi test thất bại. `DATABASE_URL` chỉ dùng để kết nối tới server PostgreSQL (chạy `CREATE/DROP DATABASE`); **không có dữ liệu mẫu nào được ghi vào database phát triển**. Cần role có quyền `CREATEDB` (role `brewlite` của `docker compose` và của CI đã có) và PostgreSQL 13 trở lên. Chỉ chấp nhận máy chủ cục bộ (`localhost`, `127.0.0.1`).

```powershell
docker compose up -d db
$env:DATABASE_URL = "<giá trị trong backend/.env>"
$env:RUN_DB_TESTS = "1"
npm --prefix backend test -- inventory.integration unit-of-work.integration
Remove-Item Env:RUN_DB_TESTS
Remove-Item Env:DATABASE_URL
```

Nếu tiến trình test bị tắt đột ngột (đóng cửa sổ, Ctrl+C) thì database tạm có thể còn sót lại. Xem và xóa:

```powershell
docker compose exec db psql -U brewlite -d brewlite -c "SELECT datname FROM pg_database WHERE datname LIKE 'brewlite_test_%';"
docker compose exec db psql -U brewlite -d brewlite -c 'DROP DATABASE "brewlite_test_xxxxxxxxxxxx" WITH (FORCE);'
```

Với `stock = N`, tổng số đơn giữ được hàng luôn `<= N` và `stock` cuối cùng bằng `N` trừ số đơn thành công, không bao giờ âm. Khi tranh chấp cao, một số request có thể nhận `STOCK_CONFLICT` dù còn hàng; đó là kết quả hợp lệ và client gửi lại.

## Kết quả chạy trên PostgreSQL thật

Chạy ngày 24/10/2026 trên PostgreSQL 17 của `docker compose` (service `db`), lệnh `npm --prefix backend test -- inventory.integration unit-of-work.integration` với `RUN_DB_TESTS=1`. Mỗi suite tự tạo database tạm `brewlite_test_<ngẫu nhiên>`, áp dụng đủ migration và xóa sau khi xong. Kết quả: 2 suite, 6/6 test đạt (tổng 26,2 giây). Sau khi chạy, truy vấn `pg_database` không còn database `brewlite_test_%` nào (0 dòng), và database phát triển `brewlite` không nhận dữ liệu mẫu.

| Suite | Kịch bản | Kết quả kiểm chứng |
| --- | --- | --- |
| `inventory.integration` | `stock = 1`, 10 request đồng thời | Đúng 1 request giữ được, 9 request bị từ chối (`OUT_OF_STOCK` hoặc `STOCK_CONFLICT`), `stock` cuối = 0 |
| `inventory.integration` | `stock = 5`, 20 request đồng thời | Số request thành công từ 1 đến 5, `stock` cuối bằng 5 trừ số request thành công, không âm |
| `inventory.integration` | Đơn có hai dòng cùng sản phẩm, tổng vượt tồn | `OUT_OF_STOCK`, `stock` không đổi |
| `inventory.integration` | Hai sản phẩm, sản phẩm thứ hai hết hàng | `OUT_OF_STOCK`, lượt giữ ở sản phẩm thứ nhất được rollback |
| `inventory.integration` | Cùng một đơn `release` 3 lần đồng thời | `stock` tăng đúng một lần, đơn ở `RELEASED` |
| `unit-of-work.integration` | Hai transaction khóa hai sản phẩm theo thứ tự ngược nhau (deadlock thật) | PostgreSQL hủy một bên, `UnitOfWork` chạy lại, cả hai cùng commit; tổng số lần chạy callback ít nhất 3; mỗi sản phẩm bị trừ đúng một lần cho mỗi bên (10 xuống 8) |

Các kịch bản không đồng thời của `UnitOfWork` (hết 3 lượt trả `STOCK_CONFLICT`, rollback sản phẩm đã trừ trước đó, không thử lại lỗi nghiệp vụ, rollback bản ghi idempotency cùng lần thử bị hủy) được kiểm chứng ở `unit-of-work.e2e-spec.ts` bằng `$transaction` giả có rollback, vì không thể ép PostgreSQL deadlock đủ 3 lần liên tiếp một cách ổn định. Luồng tạo đơn qua `OrdersService.create` được kiểm chứng riêng ở `orders-create.integration-spec.ts`; luồng thanh toán của TV5 chưa nằm trong các test này và cần chạy lại khi được nối.
