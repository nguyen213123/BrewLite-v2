# Hợp đồng API BrewLite v1.0.0

Base URL local: `http://localhost:3001/api`. JSON UTF-8. CORS mặc định cho `http://localhost:3000`.

## Health endpoints

| Method | Endpoint | Thành công | Thất bại |
| --- | --- | --- | --- |
| GET | `/health` | 200: `{"status":"ok","service":"brewlite-api"}` | Không kiểm tra database |
| GET | `/health/ready` | 200: `{"status":"ok","database":"connected"}` | 503 khi không kết nối được PostgreSQL |

Liveness không phụ thuộc database; readiness chạy `SELECT 1`. Readiness không xác nhận migration nghiệp vụ đã đầy đủ.

ValidationPipe đã bật `whitelist`, `forbidNonWhitelisted`, `transform`. Thành viên cần khai báo DTO bằng class và decorator của class-validator cho endpoint mới.

## Bộ contract cho 5 thành viên

- [OpenAPI 3.0.3](openapi.yaml): 17 operation, schema request/response, JWT, phân trang, HTTP status và ví dụ thành công/lỗi. Mở file bằng Swagger Editor hỗ trợ OpenAPI 3.0 hoặc extension OpenAPI trong IDE. Dùng file local; không cần gửi JWT hoặc dữ liệu thật vào công cụ online.
- [Fixture JSON](examples.json): dữ liệu catalog/mã mẫu và request/response cho frontend làm trước khi backend xong. Fixture không phải seed đang chạy hoặc tài khoản thật.
- [Quy tắc nghiệp vụ](../requirements/business-rules.md): State Machine đầy đủ, công thức, transaction, quyền, retry và idempotency.
- [ERD](../diagrams/erd.md), [schema Prisma tham chiếu](../diagrams/schema.prisma): quan hệ, ràng buộc, index và chủ bảng.
- [Bàn giao cho nhóm](../requirements/team-handoff.md): issue của từng thành viên, dịch vụ cần cung cấp và thứ tự merge.

Trạng thái 26/10/2026: toàn bộ 17 operation trong OpenAPI đã có implementation, gồm catalog, JWT, quote/create/history/cancel/STAFF status, payment, promotion và loyalty. Dữ liệu nghiệp vụ lưu trên PostgreSQL; gateway thanh toán là mock theo phạm vi MVP. Xem [hướng dẫn module](skeleton.md) và [kết quả nghiệm thu](../qa/final/README.md). Response 501 còn trong contract/fixture để tham chiếu giai đoạn skeleton cũ, không phải kết quả mong đợi của các route đã tích hợp.

## Quy ước chung

- Prefix `/api`, JSON UTF-8. Request có JSON body gửi `Content-Type: application/json`.
- JWT: `Authorization: Bearer <accessToken>`; xem chi tiết issuer/audience/expiry trong quy tắc nghiệp vụ.
- Không bọc success bằng `data` trừ endpoint phân trang: `{ data: [...], meta: { page, limit, total, totalPages } }`. Mặc định page=1, limit=12, tối đa 50. Trang ngoài phạm vi trả data rỗng với tổng thật; dataset rỗng có totalPages=0.
- UUID cho ID/key; timestamp UTC ISO 8601; tiền nguyên VND; size S/M/L; payment WALLET/CARD.
- OrderRequest chỉ có items và promotionCode tùy chọn. Không dùng promotionCode=null/chuỗi rỗng; bỏ field nếu không có mã. toppingIds có thể bỏ và được chuẩn hóa thành []. Không gửi giá/userId từ client.
- Body phải đúng schema, từ chối field thừa; query page/limit parse số nguyên rồi validate, từ chối query không được khai báo. Email và mã promo được chuẩn hóa trước validate nghiệp vụ; UUID/key viết lowercase chuẩn, password giữ nguyên.
- `POST /orders` và `POST /payments` phải có Idempotency-Key UUID. Replay giữ HTTP status/body ban đầu, header Idempotency-Replayed=true; UI lấy lại order hiện tại sau replay.
- Router NestJS đăng ký `/orders/me` và `/orders/quote` trước `/:id` để không nhận nhầm UUID. Không dùng history endpoint chung cho STAFF truy cập mọi khách.
- CORS expose `Idempotency-Replayed` và `Retry-After` để frontend đọc được; allow Authorization/Content-Type/Idempotency-Key. TV4 phối hợp cập nhật setup và error filter dùng chung.

## Danh mục lỗi chuẩn cho endpoint nghiệp vụ

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Dữ liệu không hợp lệ",
  "details": [{ "field": "items.0.qty", "message": "qty phải là số nguyên từ 1 đến 99" }]
}
```

| HTTP | Code | Ý nghĩa |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | Body/query/path/header sai hoặc field thừa |
| 401 | UNAUTHORIZED / INVALID_CREDENTIALS | JWT thiếu/sai/hết hạn hoặc login sai |
| 403 | FORBIDDEN | Customer gọi thao tác chỉ dành cho STAFF |
| 404 | PRODUCT_NOT_FOUND / ORDER_NOT_FOUND | Không tìm thấy; đơn không thuộc user cũng dùng ORDER_NOT_FOUND |
| 409 | EMAIL_ALREADY_EXISTS | Email chuẩn hóa đã tồn tại |
| 409 | OUT_OF_STOCK / STOCK_CONFLICT | Không đủ stock hoặc retry optimistic locking hết lượt |
| 409 | PROMOTION_EXHAUSTED | Mã đã hết lượt giữ/sử dụng |
| 409 | ORDER_NOT_PAYABLE | Key payment mới cho đơn không còn trạng thái có thể thanh toán |
| 409 | INVALID_ORDER_TRANSITION / ORDER_VERSION_CONFLICT | Cạnh trạng thái không hợp lệ hoặc expectedVersion cũ |
| 409 | IDEMPOTENCY_KEY_REUSED | Cùng key/scope/user nhưng payload khác |
| 409 | IDEMPOTENCY_IN_PROGRESS | Transaction key đang cạnh tranh quá timeout; Retry-After: 1 |
| 422 | PRODUCT_UNAVAILABLE / INVALID_PRODUCT_OPTION | Product ngừng bán hoặc size/topping không hợp lệ |
| 422 | PROMOTION_INVALID | Mã sai, ngoài thời gian hoặc chưa đủ điều kiện |
| 500 | INTERNAL_ERROR | Lỗi ngoài dự kiến, không lộ SQL/stack/secret |
| 501 | FEATURE_NOT_IMPLEMENTED | Legacy skeleton; không phải hành vi nghiệm thu của runtime hiện tại |

details luôn là mảng (có thể rỗng). Client xử lý theo code, không parse message. Exception filter và ValidationPipe exceptionFactory dùng chung đã có trong skeleton; TV4 tiếp tục dùng khi hoàn thiện auth. `/health/ready` giữ nguyên lỗi legacy 503 có statusCode/message/error như OpenAPI. Các route không tồn tại dùng framework code NOT_FOUND, không phải ORDER_NOT_FOUND của service nghiệp vụ.

## Bảng endpoint và chủ trì

| Method | Path sau /api | JWT | Chủ trì |
| --- | --- | --- | --- |
| GET | /products, /products/{id} | Không | TV1 |
| POST | /auth/register, /auth/login | Không | TV4 |
| GET | /auth/me | Có | TV4 |
| POST | /orders/quote, /orders | Có | TV3 |
| GET | /orders/me, /orders/{id} | Có | TV3 làm dịch vụ; TV4 làm API đọc/UI lịch sử |
| POST | /orders/{id}/cancel | Chủ đơn | TV3 |
| PATCH | /orders/{id}/status | STAFF | TV3 |
| POST | /payments | Chủ đơn | TV5 |
| POST | /promotions/validate | Có | TV1 |
| GET | /loyalty/me, /loyalty/me/entries | Có | TV4 |

TV2 dùng toàn bộ contract để làm UI, không tạo một kiểu payload khác cho checkout. Các module dùng chung unit-of-work của TV3; không mở transaction riêng cho hiệu ứng cần commit cùng payment/order.

## Kiểm tra contract

```powershell
npm run docs:check
npm run docs:schema
```

docs:check kiểm tra cấu trúc OpenAPI, local references, request/response fixture, HTTP status và công thức trong fixture. Prisma validate chỉ kiểm tra tính hợp lệ schema tham chiếu, không chạy migration hoặc kiểm thử transaction. Khi thay schema runtime sau này, vẫn cần PostgreSQL integration test theo business-rules.md.
