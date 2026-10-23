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

### Vì sao thử lại ngay trong transaction

Baseline mô tả "retry toàn bộ transaction tối đa 3 lần". `UnitOfWork` chạy ở `READ COMMITTED`. Ở mức này, khi một transaction khác đã commit thay đổi dòng `Product`, câu `UPDATE ... WHERE version = ?` của ta chờ rồi đánh giá lại điều kiện trên dòng mới và khớp 0 dòng, **không** gây lỗi database. Transaction vẫn dùng được, câu `SELECT` kế tiếp thấy dữ liệu mới đã commit, nên thử lại từng sản phẩm có hiệu lực giống việc chạy lại cả transaction, mà không phải bóc tách callback của lớp idempotency (TV5). Các lỗi làm hỏng transaction (deadlock, lock timeout 3 giây, serialization) vẫn lan ra ngoài để rollback; việc có thử lại ở tầng trên hay không do người gọi quyết định.

## `release`: chỉ trả một lần

`release(tx, order)` trước hết chuyển `reservationStatus` từ `HELD`/`CONSUMED` sang `RELEASED` bằng câu cập nhật có điều kiện. Nếu `count = 0` (đã `RELEASED`, do request khác hoặc lần gọi trước) thì **dừng, không cộng tồn kho**. Nếu `count = 1` thì cộng lại `qty` (đã gộp theo sản phẩm, theo thứ tự id tăng dần) và tăng `version`. Vì việc chuyển trạng thái và cộng tồn nằm cùng transaction, hai lần `release` đồng thời chỉ có một lần có hiệu lực. Nhờ vậy thanh toán lỗi lặp, hủy lặp hay request trùng không hoàn kho hai lần.

`release` chỉ đổi `reservationStatus`. `status` và `version` của đơn do dịch vụ chuyển trạng thái (#8) cập nhật.

## Kiểm thử

- `backend/test/inventory-stock.e2e-spec.ts`: logic gộp qty, thứ tự duyệt, thử lại, `OUT_OF_STOCK`/`STOCK_CONFLICT`, `release` đúng một lần (không cần database).
- `backend/test/inventory.integration-spec.ts`: PostgreSQL thật, gồm 10 request cùng tranh `stock = 1`, 20 request tranh `stock = 5`, gộp dòng trùng sản phẩm, rollback nhiều sản phẩm và `release` đồng thời. Chạy khi đặt `RUN_DB_TESTS=1`:

```powershell
docker compose up -d db
npm --prefix backend run prisma:deploy
$env:RUN_DB_TESTS = "1"
npm --prefix backend test -- inventory.integration
```

Với `stock = N`, tổng số đơn giữ được hàng luôn `<= N` và `stock` cuối cùng bằng `N` trừ số đơn thành công, không bao giờ âm. Khi tranh chấp cao, một số request có thể nhận `STOCK_CONFLICT` dù còn hàng; đó là kết quả hợp lệ và client gửi lại.

## Kết quả chạy trên PostgreSQL thật

Chạy ngày 23/10/2026 với database PostgreSQL của `docker compose` (service `db`), 2 migration đã áp dụng, lệnh `npm --prefix backend test -- inventory.integration` với `RUN_DB_TESTS=1`. Kết quả: 1 suite, 5/5 test đạt (6,8 giây).

| Kịch bản | Kết quả | Thời gian |
| --- | --- | --- |
| `stock = 1`, 10 request đồng thời | Đúng 1 request giữ được, 9 request bị từ chối (`OUT_OF_STOCK` hoặc `STOCK_CONFLICT`), `stock` cuối = 0 | 796 ms |
| `stock = 5`, 20 request đồng thời | Số request thành công nằm trong khoảng 1 đến 5, `stock` cuối = 5 trừ số request thành công, không âm | 164 ms |
| `stock = 3`, một đơn có hai dòng cùng sản phẩm, mỗi dòng 2 ly | Bị từ chối `OUT_OF_STOCK`, `stock` vẫn = 3 | 24 ms |
| Hai sản phẩm, sản phẩm thứ hai hết hàng | Bị từ chối `OUT_OF_STOCK`, lượt giữ ở sản phẩm thứ nhất được rollback, `stock` vẫn như ban đầu | 37 ms |
| Cùng một đơn `release` 3 lần đồng thời | Cả 3 lần hoàn tất, `stock` tăng đúng 1 lần (7 thành 10), đơn ở `RELEASED` | 333 ms |

Các kịch bản trên khẳng định tổng lượng giữ thành công không vượt tồn ban đầu, không có tồn âm, đơn bị từ chối không để lại hiệu ứng dở dang và hoàn kho chỉ xảy ra một lần. Bài test chưa gồm luồng tạo đơn qua `POST /orders` hay thanh toán lặp, vì các phần đó chờ #7 được merge và module TV5; cần chạy lại test tích hợp khi đã nối đủ.
