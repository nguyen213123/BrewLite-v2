# Chiến lược tồn kho và xử lý đồng thời (Issue #9)

Tài liệu này giải thích cách `InventoryService` (`backend/src/modules/inventory/`) quản lý tồn kho theo nguyên liệu và công thức món, giữ/hoàn kho nguyên tử và chống bán vượt tồn. Tài liệu hoàn toàn đồng bộ với [business-rules.md](business-rules.md) §5 và đặc tả thiết kế (spec A1–A7).

## Đơn vị tồn kho

Tồn kho được quản lý tập trung ở mức nguyên liệu (`Ingredient`), lưu trữ theo đơn vị đo lường gốc: `GRAM`, `ML`, `PIECE`. Cột `Ingredient.stock` có ràng buộc `CHECK (stock >= 0)` ở mức database làm chốt chặn bảo vệ cuối cùng. Cột `Product.stock` đã được loại bỏ khỏi database.

- Mỗi nguyên liệu có `packageSize` (CHECK `> 0`) và `packageLabel` (ví dụ 250 g/"túi", 1000 ml/"hộp").
- **Công thức món (`ProductIngredient`)** quy định định lượng nguyên liệu cho size S (`amount > 0`).
- **Hệ số kích cỡ (`SIZE_FACTOR_PCT`)**: S = 100%, M = 125%, L = 150%. Định lượng theo size tính bằng:
  `perCupAmount(amount, unit, size) = unit === 'PIECE' ? amount : Math.ceil(amount * SIZE_FACTOR_PCT[size] / 100)`.
  Đơn vị `PIECE` (ví dụ chanh tươi) không nhân hệ số size (1 quả chanh luôn là 1 quả ở mọi size).
- **Công thức topping (`ToppingIngredient`)** quy định định lượng cho 1 phần phục vụ (`amount > 0`), không nhân hệ số size.
- **Số ly còn bán được của một size:** min trên mọi nguyên liệu trong công thức của $\lfloor stock / perCupAmount \rfloor$. Nếu công thức rỗng, trả về 0 (hết hàng).
- **Số phần topping còn lại:** min trên mọi nguyên liệu trong công thức topping của $\lfloor stock / amount \rfloor$. Nếu công thức rỗng, trả về 0 (hết hàng).
- `ProductSummary.stock` trả về qua API là số ly khả dụng của size S (luôn là giá trị lớn nhất trong ba size).

## Vòng đời giữ chỗ (`Order.reservationStatus`)

| Thời điểm | Hiệu ứng lên tồn kho nguyên liệu | Ai thực hiện |
| --- | --- | --- |
| Tạo đơn PENDING | `reserve`: trừ `Ingredient.stock`, lưu snapshot vào `OrderIngredientHold`, đơn ở `HELD` | `InventoryPort.reserve` gọi trong transaction tạo đơn |
| PENDING → PAID | Không đổi tồn kho nguyên liệu; `HELD` → `CONSUMED` | Dịch vụ chuyển trạng thái đơn hàng |
| PENDING → PAYMENT_FAILED, hủy đơn | `release`: chuyển có điều kiện `HELD` → `RELEASED`, hoàn lại đúng lượng nguyên liệu từ `OrderIngredientHold` | `InventoryPort.release` |
| PAID → CANCELLED (trước PREPARING) | `release`: chuyển có điều kiện `CONSUMED` → `RELEASED`, hoàn lại đúng lượng nguyên liệu từ `OrderIngredientHold` | `InventoryPort.release` |
| PAYMENT_FAILED → PENDING (thử lại) | `prepareRetry`: xóa hold cũ, `reserve` lại nguyên liệu theo công thức hiện tại (bao gồm cả topping đã chọn), ghi hold mới, `RELEASED` → `HELD` | Dịch vụ chuyển trạng thái gọi `prepareRetry` |
| PAYMENT_FAILED → CANCELLED | Không trả lần hai (đã `RELEASED`) | `release` là no-op (câu lệnh điều kiện khớp 0 dòng) |
| Lời gọi trùng lặp (duplicate calls) | Cập nhật trạng thái có điều kiện ngăn chặn hoàn kho lặp | `release` kiểm tra `count === 0` và dừng ngay |

## `reserve`: transaction + optimistic locking

`reserve(tx, orderId, items)` luôn chạy **bên trong transaction của người gọi** (khi tạo đơn hoặc khi thử lại thanh toán `prepareRetry`). Nó không tự mở transaction, nên mọi thay đổi tồn kho nằm cùng một lần commit/rollback với đơn hàng, lượt khuyến mãi và idempotency key.

1. **Kiểm tra công thức:** Mọi món và topping được chọn đều phải có công thức (`prepareRequired`). Món hoặc topping thiếu công thức bị từ chối ngay với `409 OUT_OF_STOCK` ("Không đủ nguyên liệu cho món đã chọn").
2. **Gộp nguyên liệu theo `ingredientId`:**
   - Với mỗi món: cộng `perCupAmount(amount, unit, size) * qty` cho từng nguyên liệu trong công thức món.
   - Với mỗi topping đã chọn: cộng `amount * qty` cho từng nguyên liệu trong công thức topping.
   - Gộp tổng nhu cầu theo `ingredientId`. Nếu món và topping cùng dùng chung một nguyên liệu (ví dụ Trà sữa trân châu và topping Trân châu đều dùng hạt trân châu), nhu cầu được cộng dồn chính xác trước khi giữ kho.
3. **Duyệt nguyên liệu theo `ingredientId` tăng dần:** Mọi request đều khóa và cập nhật nguyên liệu theo cùng một thứ tự tăng dần của khóa chính, loại trừ hoàn toàn nguy cơ deadlock vòng giữa các transaction cạnh tranh.
4. Với mỗi nguyên liệu, tối đa **3 lần thử (`MAX_STOCK_ATTEMPTS = 3`)**:
   - Đọc `stock`, `version`.
   - Nếu `stock < amount`: trả ngay `409 OUT_OF_STOCK` ("Không đủ nguyên liệu cho món đã chọn").
   - Cập nhật có điều kiện, nguyên tử trong một câu lệnh:
     `UPDATE Ingredient SET stock = stock - amount, version = version + 1 WHERE id = ? AND version = ? AND stock >= amount`.
   - `count = 1`: thành công.
   - `count = 0`: người khác vừa cập nhật dòng nguyên liệu này, đọc lại `stock`/`version` và thử tiếp.
5. Hết 3 lần vẫn thua cuộc đua: trả `409 STOCK_CONFLICT` ("Tồn kho đang thay đổi, vui lòng thử lại"). Thiếu hàng thật luôn trả `409 OUT_OF_STOCK`, không bị che bởi `STOCK_CONFLICT`.
6. **Lưu snapshot giữ kho (`OrderIngredientHold`):**
   - Xóa các bản ghi hold cũ của đơn nếu có (`deleteMany where { orderId }`).
   - Ghi nhận các dòng `OrderIngredientHold (orderId, ingredientId, amount)`.
7. Mọi lỗi ném ra khỏi `reserve` làm transaction của người gọi **rollback toàn bộ**, kể cả các nguyên liệu đã trừ trước đó trong cùng đơn. Đơn bị từ chối không để lại đơn dở dang hay tồn kho bị giữ.

### Hai tầng thử lại

Baseline yêu cầu "retry toàn bộ transaction tối đa 3 lần cho xung đột version/deadlock/serialization, đọc lại dữ liệu mỗi lần, hết lượt trả `409 STOCK_CONFLICT`" (business-rules §5). Hiện thực chia theo loại lỗi, vì mỗi loại chỉ thử lại được ở một tầng:

| Loại lỗi | Tầng thử lại | Vì sao |
| --- | --- | --- |
| Xung đột version: `UPDATE ... WHERE version = ?` khớp 0 dòng | Trong `InventoryService.holdIngredient`, tối đa 3 lần, đọc lại `stock`/`version` mỗi lần | Ở `READ COMMITTED`, câu `UPDATE` bị từ chối nhẹ nhàng (0 dòng, không có lỗi database), transaction vẫn dùng được và `SELECT` kế tiếp thấy dữ liệu đã commit |
| Deadlock (`40P01`), serialization failure (`40001`), Prisma `P2034` | `UnitOfWork.run`, **chạy lại toàn bộ transaction**, tối đa 3 lần | PostgreSQL đã hủy transaction; không thể thử lại câu lệnh bên trong nó. Mỗi lần là một transaction mới, đọc lại mọi dữ liệu, và các thay đổi của lần bị hủy (kể cả các nguyên liệu đã trừ trước đó) đã bị database rollback |

Hết lượt ở một trong hai tầng đều trả `409 STOCK_CONFLICT`; thiếu hàng thật luôn trả `409 OUT_OF_STOCK`. Không thử lại `lock_timeout` (3 giây), transaction timeout (5 giây) và mọi lỗi nghiệp vụ (`ApiError`): chúng được báo ngay (ví dụ `IDEMPOTENCY_IN_PROGRESS` do lớp idempotency xử lý).

Có tới 3 lần chạy callback, nên với người gọi `UnitOfWork.run` có ba ràng buộc:

1. Callback chỉ được thay đổi dữ liệu qua `tx`; không gửi email, gọi dịch vụ ngoài hay giữ trạng thái trong bộ nhớ qua các lần thử.
2. **Phối hợp với idempotency (TV5):** `IdempotencyPort.execute` phải chạy trong `UnitOfWork.run` (không tự mở `$transaction`) và chiếm Idempotency-Key **bên trong** `tx`. Khi một lần thử bị hủy, bản ghi key và mọi tác dụng phụ (kho, lượt ưu đãi, đơn, event) cùng bị rollback, lần thử sau chiếm key lại từ đầu, nên cùng một yêu cầu không bao giờ tạo hiệu ứng hai lần.
3. Hết lượt, client được phép gửi lại với cùng Idempotency-Key.

## `release`: snapshot hold & chỉ trả một lần

`release(tx, order)` giải quyết trọn vẹn hai bài toán lớn trong quản lý tồn kho theo công thức:

1. **Chống hoàn kho lặp:** Trước hết chuyển `reservationStatus` từ `HELD`/`CONSUMED` sang `RELEASED` bằng câu lệnh cập nhật có điều kiện:
   `UPDATE Order SET reservationStatus = 'RELEASED' WHERE id = ? AND reservationStatus IN ('HELD', 'CONSUMED')`.
   Nếu `count = 0` (đã `RELEASED`, do request khác hoặc lần gọi trước) thì **dừng ngay, không cộng tồn kho**.
2. **Hoàn trả đúng lượng nguyên liệu thực tế đã giữ:** Nếu `count = 1`, hệ thống đọc danh sách giữ kho từ bảng snapshot `OrderIngredientHold` theo `orderId`, sắp xếp theo `ingredientId` tăng dần, sau đó hoàn trả chính xác số lượng `amount` cho từng `Ingredient.stock` và tăng `Ingredient.version`:
   `UPDATE Ingredient SET stock = stock + amount, version = version + 1 WHERE id = ?`.
   Nhờ có snapshot `OrderIngredientHold`, nếu công thức món hoặc topping bị thay đổi sau thời điểm tạo đơn (ví dụ do cập nhật danh mục hoặc nạp lại seed), hệ thống vẫn hoàn trả **đúng lượng nguyên liệu thực tế đã trừ**, không phụ thuộc vào công thức mới.

`release` chỉ cập nhật `reservationStatus` và hoàn trả nguyên liệu. `status` và `version` của đơn do dịch vụ State Machine quản lý.

## Thử lại thanh toán (`prepareRetry`)

Khi đơn hàng rơi vào `PAYMENT_FAILED`, toàn bộ tồn kho nguyên liệu đã được hoàn trả (`RELEASED`). Khi khách hàng thực hiện thử lại thanh toán:

1. Dịch vụ State Machine gọi `prepareRetry` kèm theo danh sách `items` chứa đầy đủ thông tin `productId`, `size`, `qty` và danh sách `toppingIds` đã chọn.
2. `prepareRetry` chạy `reserve(tx, order.id, items)`:
   - Xóa các dòng hold cũ của đơn trong `OrderIngredientHold`.
   - Trừ kho nguyên liệu theo công thức hiện tại của các món kèm topping đã chọn.
   - Ghi nhận snapshot hold mới vào `OrderIngredientHold`.
3. Nếu không đủ nguyên liệu (do người khác đã mua hết trong lúc chờ thanh toán), transaction rollback và đơn vẫn giữ nguyên trạng thái `PAYMENT_FAILED`.

## Kiểm thử

- `backend/test/recipe.e2e-spec.ts`: tính toán định lượng theo size (S/M/L), hệ số làm tròn lên (`Math.ceil`), nguyên liệu `PIECE` không nhân hệ số, công thức topping 1 phần, ước lượng số ly khả dụng theo công thức, gộp nguyên liệu khi món và topping cùng dùng chung nguyên liệu.
- `backend/test/inventory-stock.e2e-spec.ts`: logic gộp nguyên liệu theo `ingredientId`, thứ tự duyệt tăng dần, thử lại theo `Ingredient.version`, `OUT_OF_STOCK` / `STOCK_CONFLICT`, ghi nhận snapshot `OrderIngredientHold` và `release` hoàn đúng lượng đã giữ một lần duy nhất (không cần database).
- `backend/test/unit-of-work.e2e-spec.ts` (không cần database; `$transaction` giả có rollback thật): lỗi tạm thời rồi thành công, hết 3 lượt trả `STOCK_CONFLICT`, nguyên liệu đã trừ trước đó được rollback, không thử lại `OUT_OF_STOCK`/lock timeout/lỗi thường, bản ghi key idempotency được rollback cùng lần thử bị hủy.
- `backend/test/inventory.integration-spec.ts` (PostgreSQL thật): tranh chấp nguyên liệu đồng thời, đơn có hai dòng cùng nguyên liệu, hai nguyên liệu với nguyên liệu thứ hai hết hàng thì nguyên liệu thứ nhất được rollback, đơn và topping cùng dùng nguyên liệu được gộp chính xác, và `release` đồng thời chỉ hoàn một lần.
- `backend/test/unit-of-work.integration-spec.ts` (PostgreSQL thật): hai transaction khóa hai nguyên liệu theo thứ tự ngược nhau để tạo **deadlock thật**; PostgreSQL hủy một bên, `UnitOfWork` chạy lại nó, cả hai cùng commit và mỗi nguyên liệu chỉ bị trừ đúng một lần cho mỗi bên.
- `backend/test/orders-create.integration-spec.ts` (PostgreSQL thật): `OrdersService.create`, `InventoryService`, `OrderTransactionsService` và `UnitOfWork` thật. 10 đơn tranh nguyên liệu cho 1 ly, 20 đơn tranh 5 ly, đơn bị từ chối không để lại đơn hay tồn kho bị giữ, tạo rồi hủy trả đúng số nguyên liệu đã giữ từ `OrderIngredientHold`.

Các suite PostgreSQL tự tạo một database tạm `brewlite_test_<ngẫu nhiên>` (áp dụng đủ migration bằng `prisma migrate deploy`), ghi toàn bộ dữ liệu mẫu vào đó và xóa nó trong `afterAll`, kể cả khi test thất bại. `DATABASE_URL` chỉ dùng để kết nối tới server PostgreSQL (chạy `CREATE/DROP DATABASE`); **không có dữ liệu mẫu nào được ghi vào database phát triển**. Cần role có quyền `CREATEDB` (role `brewlite` của `docker compose` và của CI đã có) và PostgreSQL 13 trở lên. Chỉ chấp nhận máy chủ cục bộ (`localhost`, `127.0.0.1`).

```powershell
docker compose up -d db
$env:DATABASE_URL = "<giá trị trong backend/.env>"
$env:RUN_DB_TESTS = "1"
npm --prefix backend test -- inventory.integration unit-of-work.integration orders-create.integration
Remove-Item Env:RUN_DB_TESTS
Remove-Item Env:DATABASE_URL
```

Nếu tiến trình test bị tắt đột ngột (đóng cửa sổ, Ctrl+C) thì database tạm có thể còn sót lại. Xem và xóa:

```powershell
docker compose exec db psql -U brewlite -d brewlite -c "SELECT datname FROM pg_database WHERE datname LIKE 'brewlite_test_%';"
docker compose exec db psql -U brewlite -d brewlite -c 'DROP DATABASE "brewlite_test_xxxxxxxxxxxx" WITH (FORCE);'
```

Với nguyên liệu đủ cho `N` ly, tổng số đơn giữ được hàng luôn `<= N` và lượng nguyên liệu còn lại tương ứng với `N` trừ số đơn thành công, không bao giờ âm. Khi tranh chấp cao, một số request có thể nhận `STOCK_CONFLICT` dù còn hàng; đó là kết quả hợp lệ và client gửi lại.

## Kết quả chạy trên PostgreSQL thật

Chạy trên PostgreSQL 17 của `docker compose` (service `db`), lệnh `npm run test:db` với `RUN_DB_TESTS=1`. Mỗi suite tự tạo database tạm `brewlite_test_<ngẫu nhiên>`, áp dụng đủ 5 bản migration và xóa sau khi xong. Toàn bộ 25 suite backend (427 tests) và 89 tests frontend đều đạt (0 fail, 0 warnings/errors).

| Suite | Kịch bản | Kết quả kiểm chứng |
| --- | --- | --- |
| `inventory.integration` | Nguyên liệu đủ 1 ly, 10 request đồng thời | Đúng 1 request giữ được, 9 request bị từ chối (`OUT_OF_STOCK` hoặc `STOCK_CONFLICT`), tồn kho cuối về 0 |
| `inventory.integration` | Nguyên liệu đủ 5 ly, 20 request đồng thời | Số request thành công từ 1 đến 5, nguyên liệu còn lại chính xác, không âm |
| `inventory.integration` | Đơn có hai dòng cùng dùng một nguyên liệu, tổng vượt tồn | `OUT_OF_STOCK`, nguyên liệu không đổi |
| `inventory.integration` | Hai nguyên liệu, nguyên liệu thứ hai hết hàng | `OUT_OF_STOCK`, lượt giữ ở nguyên liệu thứ nhất được rollback |
| `inventory.integration` | Món và topping cùng dùng chung nguyên liệu (Trà sữa trân châu + Trân châu) | Nhu cầu nguyên liệu được gộp chính xác, trừ kho đúng tổng lượng |
| `inventory.integration` | Cùng một đơn `release` 3 lần đồng thời | Nguyên liệu tăng đúng một lần theo `OrderIngredientHold`, đơn ở `RELEASED` |
| `unit-of-work.integration` | Hai transaction khóa hai nguyên liệu theo thứ tự ngược nhau (deadlock thật) | PostgreSQL hủy một bên, `UnitOfWork` chạy lại, cả hai cùng commit; tổng số lần chạy callback ít nhất 3; mỗi nguyên liệu bị trừ đúng một lần cho mỗi bên |
