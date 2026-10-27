# Quy tắc nghiệp vụ BrewLite v1

Ngày chốt kỹ thuật: 22/10/2026. Phục vụ issue #1, Task 2–10 của đề BrewLite VER 1.0. Đây là baseline triển khai để nhóm review qua PR, không phải bằng chứng đã được cả nhóm phê duyệt. Các quyết định cụ thể dưới đây là lựa chọn thiết kế của nhóm; không phải tất cả đều được đề quy định.

## 1. Phạm vi và nguồn sự thật

- Bắt buộc: Next.js, NestJS, menu, size S/M/L, topping, cart có badge, JWT, đơn, mock payment Ví/Thẻ, lịch sử và bốn nghiệp vụ Task 10.
- Đề gốc: mục 8–12; API dưới đây thêm prefix `/api` theo bộ khung hiện có.
- OpenAPI: `docs/api/openapi.yaml` quyết định hình dạng JSON, đường dẫn, HTTP status. `docs/api/examples.json` là fixture kiểm chứng cùng contract.
- ERD và schema tham chiếu: `docs/diagrams/erd.md`, `docs/diagrams/schema.prisma`. Khung API đã có schema runtime và migration nền theo 13 bảng này; TV3 phối hợp các chủ bảng review trước khi trưởng nhóm merge. Không tạo lại migration nền ở từng feature branch.
- Tài liệu này quyết định công thức, trạng thái, transaction và hành vi retry. Khi đổi contract, phải cập nhật cả OpenAPI, ví dụ, tài liệu và các module liên quan trong cùng PR.
- Không yêu cầu trong MVP: quản trị catalog, UI barista, cổng thanh toán thật, refresh token, sử dụng/đổi điểm lấy tiền, tự động hết hạn đơn. (Lưu ý: Tồn kho theo nguyên liệu và công thức món đã được hỗ trợ đầy đủ).

## 2. Sản phẩm, cart và giá

1. ID là UUID, thời gian ISO 8601 UTC; tiền là số nguyên VND không âm, tối đa 2.000.000.000 cho tổng một đơn. Không nhận float tiền từ client.
2. Product.price là giá size S. ProductSize lưu giá tuyệt đối của từng size S/M/L; giá S phải bằng Product.price (seed/service đảm bảo). Topping.price là giá cho một topping trên một ly. Mỗi sản phẩm có danh sách topping được phép chọn.
3. Một dòng cart: `productId`, `size`, `toppingIds` không trùng, `qty` nguyên 1–99. Một request tối đa 50 dòng, tối đa 10 topping/dòng. Tập topping được sắp xếp theo ID để nhận diện dòng; cùng sản phẩm/size/tập topping được gộp và tổng qty sau gộp không quá 99.
4. Client chỉ gửi các trường trên và promotionCode tùy chọn. Không nhận userId, price, discount, total hoặc loyaltyPoints từ client. Backend từ chối trường thừa.
5. `unitPrice = sizePrice + sum(toppingPrice)`; `lineTotal = unitPrice * qty`; `subtotal = sum(lineTotal)`; `total = subtotal - discount`. Tổng không được âm/vượt giới hạn.
6. Snapshot OrderItem lưu tên sản phẩm, size, giá size, unitPrice, qty, lineTotal; OrderItemTopping lưu ID, tên và giá topping. Lịch sử dùng snapshot, không tính lại từ catalog hiện tại.
7. `POST /orders/quote` xem giá hiện tại và kiểm tra lựa chọn, không giữ kho hoặc lượt khuyến mãi. `POST /orders` kiểm tra lại bằng transaction; quote không bảo đảm còn hàng/lượt ưu đãi.
8. Backend là nguồn giá cuối. UI hiển thị tổng từ quote, báo lỗi hết hàng/thay đổi lựa chọn và yêu cầu người dùng xem lại nếu tổng tạo đơn khác quote. Chỉ gọi payment sau khi người dùng xác nhận tổng cuối trên đơn PENDING; không âm thầm thanh toán tổng mới.
9. Cart lưu phía client (Zustand persist); badge = tổng qty. Giỏ rỗng không checkout. Thanh toán lỗi hoặc lỗi mạng giữ nguyên cart. Chỉ xóa các dòng đã mua sau khi xác nhận đơn PAID; dòng thêm sau đó vẫn giữ. Không xóa cart chỉ vì đã tạo đơn PENDING.

## 3. Xác thực và quyền

- Đăng ký: email trim/lowercase, unique; password tối thiểu 8 ký tự và tối đa 72 byte UTF-8, bcrypt cost 12, không trim password. Không trả/log password hoặc passwordHash. Tài khoản mới luôn CUSTOMER; role từ request bị từ chối.
- JWT HS256, `sub=user.id`, `role`, `iat`, `exp`; hết hạn 60 phút; issuer `brewlite-api`, audience `brewlite-web`. `JWT_SECRET` tối thiểu 32 ký tự qua env, thiếu/sai cấu hình phải fail startup khi module auth được triển khai.
- `Authorization: Bearer <accessToken>`. Frontend giữ token trong bộ nhớ và sessionStorage, xóa khi logout/401; không có refresh token hay endpoint logout ở MVP. Logout không thu hồi JWT đã cấp; token tự hết hạn.
- Guard xác minh chữ ký/issuer/audience/hạn, nạp user và role hiện tại từ DB; không dùng userId/role do client khai báo để phân quyền. Seed STAFF bằng script local, không có API public đổi role.
- Catalog công khai; auth register/login công khai. Quote/orders/payments/promotions/loyalty cần JWT. Customer chỉ xem/thanh toán/hủy đơn của mình. Đơn không tồn tại hoặc không thuộc user trả cùng `404 ORDER_NOT_FOUND`.
- Chỉ STAFF gọi endpoint đổi trạng thái pha chế; không cần UI barista. STAFF không được thanh toán/xem đơn riêng của khách qua endpoint customer. Mọi HTTP request cập nhật trạng thái vẫn qua cùng dịch vụ State Machine.
- Local CORS chỉ cho `http://localhost:3000`, cho phép header Authorization, Content-Type, Idempotency-Key; không dùng cookie auth, credentials=false. JSON lỗi được chuẩn hóa bởi filter trong module backend sau này.

## 4. Máy trạng thái đơn hàng

Theo đúng sơ đồ đề: mọi cạnh không có trong bảng đều bị `assertTransition` từ chối với `409 INVALID_ORDER_TRANSITION`.

| Từ | Sang | Trigger/quyền | Hiệu ứng nguyên tử |
| --- | --- | --- | --- |
| Chưa có | PENDING | CUSTOMER tạo đơn | Snapshot giá; giữ kho và lượt ưu đãi; tăng version |
| PENDING | PAID | Payment service, mock SUCCESS | Payment SUCCEEDED; giữ kho chuyển CONSUMED; cộng điểm đúng một lần |
| PENDING | PAYMENT_FAILED | Payment service, mock FAIL | Payment FAILED; trả kho/lượt ưu đãi; không cộng điểm |
| PAYMENT_FAILED | PENDING | Payment service khi user thử lại với key mới | Giữ lại kho/lượt ưu đãi nguyên tử; không tính lại snapshot giá; ghi OrderEvent |
| PENDING | CANCELLED | Chủ đơn qua cancel | Trả kho/lượt ưu đãi; chưa có điểm để hoàn |
| PAYMENT_FAILED | CANCELLED | Chủ đơn qua cancel | Không trả kho/lượt ưu đãi lần hai |
| PAID | CANCELLED | Chủ đơn qua cancel trước PREPARING | Mock refund Payment SUCCEEDED → REFUNDED; trả kho/lượt ưu đãi; đảo điểm EARN đúng một lần |
| PAID | PREPARING | STAFF | Chỉ đổi trạng thái và version |
| PREPARING | READY | STAFF | Chỉ đổi trạng thái và version |
| READY | COMPLETED | STAFF | Chỉ đổi trạng thái và version |

- COMPLETED và CANCELLED là trạng thái cuối. Không cho CANCELLED/COMPLETED quay lại PENDING. Không cho hủy PREPARING hoặc READY vì không có cạnh này trong đề.
- Retry payment sau PAYMENT_FAILED là hai chuyển tiếp hợp lệ trong cùng transaction: FAILED → PENDING → PAID hoặc FAILED. Nếu không giữ lại được kho/ưu đãi thì rollback, giữ PAYMENT_FAILED và không tạo attempt mới.
- Đơn PENDING giữ tài nguyên cho đến khi payment/cancel; chưa có job timeout trong MVP. UI cung cấp hủy và thử lại; dữ liệu demo được reset bằng seed có chủ đích.
- Order.version tăng sau mỗi chuyển trạng thái; thao tác trên version cũ trả `409 ORDER_VERSION_CONFLICT`. Cập nhật phải có điều kiện status/version và có OrderEvent cùng transaction. Dùng thứ tự tăng dần ingredientId khi truy cập nhiều nguyên liệu để loại trừ deadlock.
- Cancel đã CANCELLED với cùng expectedVersion hiện tại trả 200 không phát sinh hiệu ứng mới; expectedVersion cũ trả 409. Gọi payment trên PAID/PREPARING/READY/COMPLETED/CANCELLED với key mới trả 409; replay key cũ trả snapshot kết quả cũ.

## 5. Tồn kho nguyên liệu, công thức món & optimistic locking

- Quản lý tồn kho ở mức nguyên liệu (`Ingredient`): kho lưu trữ theo đơn vị đo lường gốc (`GRAM`, `ML`, `PIECE`). Mỗi nguyên liệu có `packageSize` và `packageLabel` (ví dụ 250 g/"túi", 1000 ml/"hộp"). Cột `Product.stock` đã được loại bỏ khỏi cơ sở dữ liệu; trường `stock` trả về qua API là giá trị tính toán động dựa trên lượng nguyên liệu hiện có.
- Công thức món (`ProductIngredient`) và công thức topping (`ToppingIngredient`):
  - Mỗi sản phẩm có công thức định lượng chuẩn cho size S (`amount > 0`).
  - Hệ số quy đổi kích cỡ: S = 100%, M = 125%, L = 150%. Định lượng theo size tính bằng công thức:
    `perCupAmount(amount, unit, size) = unit === 'PIECE' ? amount : Math.ceil(amount * SIZE_FACTOR_PCT[size] / 100)`.
    Đơn vị `PIECE` (ví dụ chanh tươi) không nhân hệ số size (1 quả chanh luôn là 1 quả ở mọi size).
  - Topping có công thức riêng định lượng cho 1 phần phục vụ (`amount > 0`) và không nhân hệ số size.
  - Món hoặc topping chưa có công thức được coi là hết hàng (`stock = 0`), không bao giờ được phép bán vô hạn.
- Cách tính số lượng khả dụng:
  - **Số ly còn bán được của một size:** min trên mọi nguyên liệu trong công thức của $\lfloor stock / perCupAmount \rfloor$. Nếu công thức rỗng, trả về 0.
  - **Số phần topping còn lại:** min trên mọi nguyên liệu trong công thức topping của $\lfloor stock / amount \rfloor$. Nếu công thức rỗng, trả về 0.
  - `ProductSummary.stock` là số ly còn bán được của size S (luôn là giá trị lớn nhất trong ba size).
- Quy tắc kiểm tra và giữ kho:
  - Báo giá (`POST /orders/quote`): `check(tx, items)` chỉ đọc để kiểm tra đủ nguyên liệu cho các món và topping đã chọn; thiếu nguyên liệu trả `409 OUT_OF_STOCK` với thông điệp `"Không đủ nguyên liệu cho món đã chọn"`. Không trừ kho và không tạo snapshot hold.
  - Định lượng cho đơn hàng: với mỗi dòng trong giỏ, cộng `perCupAmount * qty` cho từng nguyên liệu của món, cộng thêm `amount * qty` cho từng nguyên liệu của mỗi topping đã chọn. Sau đó **gộp nhu cầu theo `ingredientId`** (nếu món và topping cùng dùng chung một nguyên liệu, ví dụ Trà sữa trân châu và topping Trân châu, thì được gộp chính xác trước khi giữ kho) và **sắp xếp theo `ingredientId` tăng dần** để loại trừ hoàn toàn nguy cơ deadlock khi nhiều đơn hàng giữ kho đồng thời.
- Optimistic locking và retry:
  - Giữ kho thực hiện trên từng bản ghi `Ingredient` theo thứ tự `ingredientId` tăng dần: đọc `stock`, `version`; kiểm tra `stock >= required`; câu lệnh cập nhật nguyên tử có điều kiện: `UPDATE Ingredient SET stock = stock - required, version = version + 1 WHERE id = ? AND version = ? AND stock >= required`.
  - Tối đa 3 lần thử (`MAX_STOCK_ATTEMPTS = 3`) cho mỗi nguyên liệu khi gặp xung đột phiên bản (`version`). Nếu sau 3 lần vẫn không thành công, trả `409 STOCK_CONFLICT` ("Tồn kho đang thay đổi, vui lòng thử lại"). Thiếu nguyên liệu thực sự luôn trả `409 OUT_OF_STOCK` ("Không đủ nguyên liệu cho món đã chọn").
  - Toàn bộ thao tác chạy trong database transaction của người gọi (`UnitOfWork`). Bất kỳ lỗi nào (hết hàng, xung đột kho, lỗi thanh toán) đều làm rollback toàn bộ, không để lại đơn hàng dở dang hay thất thoát tồn kho.
- Snapshot giữ kho (`OrderIngredientHold`) & hoàn kho (`release`):
  - Khi tạo đơn (`reserve` thành công), hệ thống ghi lại chính xác số lượng nguyên liệu đã trừ cho đơn vào bảng `OrderIngredientHold (orderId, ingredientId, amount)`. Trạng thái giữ kho của đơn là `HELD`.
  - `Order.reservationStatus`: `HELD` lúc `PENDING`; chuyển sang `CONSUMED` khi `PAID` và trong suốt quá trình pha chế/hoàn thành; chuyển sang `RELEASED` khi thanh toán thất bại (`PAYMENT_FAILED`) hoặc đơn bị hủy (`CANCELLED`).
  - Hoàn kho (`release`): trước hết chuyển trạng thái `reservationStatus` từ `HELD`/`CONSUMED` sang `RELEASED` bằng câu lệnh cập nhật có điều kiện (`UPDATE Order SET reservationStatus = 'RELEASED' WHERE id = ? AND reservationStatus IN ('HELD', 'CONSUMED')`). Nếu thành công (`count = 1`), hệ thống nạp snapshot từ `OrderIngredientHold` và hoàn trả **đúng số lượng nguyên liệu đã giữ ban đầu**, tăng `Ingredient.version`. Cơ chế này đảm bảo:
    1. Hoàn kho đúng một lần, chống trả lặp khi có nhiều request đồng thời hoặc retry.
    2. Nếu công thức nguyên liệu của món/topping bị thay đổi sau khi tạo đơn (ví dụ do cập nhật công thức hoặc seed lại), việc hoàn kho vẫn trả đúng lượng nguyên liệu thực tế đã trừ từ snapshot hold.
  - Thử lại thanh toán (`prepareRetry` khi từ `PAYMENT_FAILED` sang `PENDING`): xóa các dòng hold cũ của đơn trong `OrderIngredientHold`, trừ kho lại theo công thức hiện tại của các món và topping đã chọn, và ghi nhận snapshot hold mới.
- Kiểm thử bắt buộc trên PostgreSQL thật: nguyên liệu đủ cho đúng 1 ly, 10 request tạo đơn đồng thời bằng idempotency key khác nhau, duy nhất 1 đơn thành công; kho nguyên liệu về 0 và không bao giờ âm. Đơn có nhiều dòng hoặc món và topping dùng chung nguyên liệu cũng không bao giờ vượt tồn.

## 6. Khuyến mãi và điểm thưởng

### Khuyến mãi — TV1

- Một mã/đơn, code trim/uppercase, 3–32 ký tự `[A-Z0-9_-]`. Loại FIXED hoặc PERCENT; FIXED.value là VND, PERCENT.value là số nguyên 1–100. Không cộng chồng mã.
- Hiệu lực `active && startsAt <= now < endsAt`, subtotal >= minSubtotal. `maxUses=null` không giới hạn. `usedCount` tính cả đơn HELD và CONSUMED; quote không tăng counter.
- FIXED: `discount=min(value, subtotal)`. PERCENT: `discount=floor(subtotal*value/100)`, chặn bởi maxDiscount nếu có, rồi chặn bởi subtotal. maxDiscount chỉ áp cho PERCENT. Điểm không tham gia giảm giá MVP.
- Giữ một lượt khi tạo đơn bằng cập nhật có điều kiện usedCount/maxUses và version; hết lượt trả `409 PROMOTION_EXHAUSTED`. Tạo đơn thất bại rollback counter. Payment thành công giữ counter nguyên; payment lỗi/hủy trả đúng một lượt. Hủy PAID cũng trả lượt.
- Snapshot code, discount trên Order. Retry đơn PAYMENT_FAILED giữ nguyên snapshot, nhưng phải kiểm tra lại hiệu lực/minSubtotal và giữ lại lượt. Mã hết hiệu lực/hết lượt thì từ chối retry; user hủy đơn và tạo đơn mới không mã hoặc mã khác. Không tự đổi tổng tiền đơn đã tạo.
- TV1 sở hữu hàm kiểm tra/tính discount; TV3 gọi cùng hàm khi quote/create/retry. Không tách transaction counter khỏi transaction đơn.

### Loyalty — TV4

- Sau PAID cộng `floor(total/10000)` điểm, dựa trên số tiền sau giảm giá. Đơn total=0 được PAID qua mock với amount=0 và nhận 0 điểm; không được tạo payment tiền thật.
- Chỉ cộng điểm trong transaction payment thành công. Ledger `(orderId, kind=EARN)` unique, ghi cả 0 điểm để ghi nhận xử lý. User.loyaltyPoints là số dư materialized, tăng cùng transaction.
- Hủy PAID trước PREPARING ghi entry REVERSE = -EARN và trừ số dư cùng transaction mock refund; unique `(orderId, REVERSE)` chống đảo lặp. PAYMENT_FAILED không có EARN.
- Không có dùng điểm, mua bằng điểm hay endpoint trừ điểm tùy ý ở MVP. Không âm số dư. API chỉ trả số dư/ledger của chủ user.

## 7. Payment và Idempotency-Key — TV5 phối hợp TV3

1. Cả `POST /orders` và `POST /payments` bắt buộc header Idempotency-Key dạng UUID. Phạm vi unique: `(userId, scope, key)`; scope là CREATE_ORDER hoặc PAY_ORDER. Khóa không được dùng lại cho payload khác trong cùng scope. Giữ bản ghi suốt vòng đời dữ liệu bài tập; không có TTL xóa tự động trong MVP.
2. Hash SHA-256 của JSON canonical sau validation/chuẩn hóa: order sort/gộp dòng và toppingIds, chuẩn hóa code; payment gồm orderId, method, mockOutcome (mặc định SUCCESS). Không hash bearer token. Cùng ý nghĩa dữ liệu có cùng hash.
3. Trong một transaction, chèn record key PROCESSING, thực hiện nghiệp vụ, lưu `httpStatus` và JSON response snapshot, chuyển COMPLETED rồi commit. Không commit PROCESSING độc lập, không gọi dịch vụ mạng trong transaction; gateway mock chạy in-process, deterministic.
4. Request trùng key/payload đã hoàn tất trả đúng HTTP status/body ban đầu và header `Idempotency-Replayed: true`; lần đầu header false. Cùng key khác payload trả `409 IDEMPOTENCY_KEY_REUSED`.
   Xác thực, DTO validation và canonical hash chạy trước lookup; replay hoàn tất phải được trả trước khi kiểm tra lại catalog/stock/trạng thái đơn hiện tại. Nếu không, request replay sau khi hết hàng hoặc PAID sẽ bị lỗi thay vì nhận kết quả gốc.
5. Unique constraint bảo vệ cả request đồng thời. Transaction cạnh tranh đợi commit rồi đọc kết quả. Nếu chạm lock/transaction timeout (lock_timeout=3s, transaction timeout=5s), rollback và trả `409 IDEMPOTENCY_IN_PROGRESS`, header Retry-After: 1; client retry cùng key. Không xóa/reclaim record đang được xử lý để chạy hai lần.
6. Validation/auth/business conflict trước khi có kết quả hoàn chỉnh rollback key cùng nghiệp vụ. Transient failure không được cache thành kết quả thành công. Mock FAIL là một kết quả hoàn chỉnh, trả HTTP 200 với payment FAILED/order PAYMENT_FAILED và được cache. Retry thực sự phải dùng key payment mới, giữ orderId cũ.
7. POST /payments nhận orderId, method WALLET/CARD, mockOutcome SUCCESS/FAIL; không nhận amount. Amount lấy Order.total. Đối với PENDING xác minh quyền; đối với PAYMENT_FAILED thực hiện re-reserve như mục 4. Payment attempt, trạng thái, reservation, promo, ledger và key cùng commit hoặc rollback.
8. Mỗi key payment tạo tối đa một Payment, mỗi đơn có thể có nhiều Payment FAILED nhưng chỉ một SUCCEEDED/REFUNDED trong vòng đời MVP. Dịch vụ dùng Order.version/status để chặn hai key khác nhau cùng thanh toán một đơn. Payment không tạo Order mới: đơn được tạo idempotent ở POST /orders. Test cùng key checkout phải chứng minh đúng một Order và một payment thành công.
9. Replay trả snapshot cũ ngay cả khi đơn đã chuyển trạng thái/hủy sau đó. UI sau replay/timeout luôn GET /orders/{id} để xem trạng thái hiện tại; không dựa chỉ vào payment snapshot cũ để hiển thị thành công hiện tại hoặc xóa cart.

## 8. Các ca nghiệm thu liên module

| Ca | Kỳ vọng |
| --- | --- |
| Cart: Cappuccino M=50000, topping Kem=10000, qty=2; SAVE10 | subtotal 120000, discount 12000, total 108000; PAID cộng 10 điểm |
| Cùng dòng/topping đảo thứ tự | Cùng cart line và cùng fingerprint order canonical |
| Client gửi total hoặc userId | 400 VALIDATION_ERROR; không tạo đơn |
| Payment FAIL | PAYMENT_FAILED, reservation RELEASED, trả kho/promo một lần, giữ cart, 0 EARN |
| Retry FAIL cùng key | Cùng response cũ; không tạo attempt hoặc trả kho thêm |
| Retry payment key mới | Cùng orderId, giữ lại tài nguyên; thành công thành PAID và một EARN |
| 2 create cùng key | Cùng Order.id/code, một lần giữ kho/promo |
| 2 payment cùng key | Một Payment, một EARN; trả cùng snapshot |
| 2 payment khác key cùng order | Tối đa một thành công; còn lại conflict; không cộng điểm hai lần |
| Đơn của user khác | 404 ORDER_NOT_FOUND; không tiết lộ dữ liệu |
| PAID → COMPLETED trực tiếp | 409 INVALID_ORDER_TRANSITION |
| PAID → CANCELLED tranh với PREPARING | Một transition thắng; refund/reverse chỉ khi cancel thắng |
| CANCELLED/COMPLETED → trạng thái khác | 409, không thay đổi dữ liệu |
| Nguyên liệu đủ 1 ly, 10 create đồng thời | Tối đa 1 đơn thành công; kho không âm |
| Mã maxUses=1, 10 create đồng thời | Tối đa 1 lượt giữ; không vượt usedCount |

Đo mục tiêu API <500ms với dữ liệu mẫu trong điều kiện bình thường; ghi rõ endpoint, percentile, dataset, concurrency và máy đo. Lock timeout cho test tranh chấp không phải cam kết dưới 500ms. Task hoàn tất khi có code chạy, PR/commit được review, validation, trạng thái UI và README theo DoD của đề.
