# Hợp đồng API ban đầu

Base URL local: `http://localhost:3001/api`. JSON UTF-8. CORS mặc định cho `http://localhost:3000`.

## Endpoint đã triển khai

| Method | Endpoint | Thành công | Thất bại |
| --- | --- | --- | --- |
| GET | `/health` | 200: `{"status":"ok","service":"brewlite-api"}` | Không kiểm tra database |
| GET | `/health/ready` | 200: `{"status":"ok","database":"connected"}` | 503 khi không kết nối được PostgreSQL |

Liveness không phụ thuộc database; readiness chạy `SELECT 1`. Readiness không xác nhận migration nghiệp vụ đã đầy đủ.

ValidationPipe đã bật `whitelist`, `forbidNonWhitelisted`, `transform`. Thành viên cần khai báo DTO bằng class và decorator của class-validator cho endpoint mới.

## Endpoint nghiệp vụ dự kiến, chưa triển khai

Catalog, auth, orders, payments, promotions và loyalty cần được chủ module thống nhất request/response, quyền truy cập và mã lỗi trước khi code. Không coi các module này là đã có chỉ vì đã xuất hiện trong kế hoạch.
