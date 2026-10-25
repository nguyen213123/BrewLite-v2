# Nghiệm thu idempotency — Issue #11

## Phạm vi

`backend/test/checkout.integration-spec.ts` khởi tạo `AppModule` không override provider, gọi HTTP với JWT thật và dùng PostgreSQL đã migrate trong database tạm. Catalog, idempotency, tạo đơn, chuyển trạng thái, tồn kho, khuyến mãi và loyalty đều dùng implementation thật. Gateway WALLET/CARD vẫn mô phỏng theo baseline bài tập.

Ba test mới gửi 10 HTTP request đồng thời với cùng key và payload:

| Kịch bản | Điều kiện kiểm chứng |
| --- | --- |
| Tạo đơn, stock = 2 và maxUses = 1 | Đúng một response gốc 201, một Order/OrderItem/event/key COMPLETED; giữ đúng 2 ly và 1 lượt khuyến mãi; replay vẫn thành công khi tài nguyên đã hết; đổi payload trả IDEMPOTENCY_KEY_REUSED |
| Thanh toán SUCCESS | Đúng một response gốc 200, một Payment, một chuyển PAID và một EARN 10 điểm; kho và lượt khuyến mãi không bị giữ lần hai; đổi phương thức với key cũ bị từ chối; người khác biết key không đọc được kết quả |
| Thanh toán FAIL rồi retry SUCCESS | FAIL được cache HTTP 200, hoàn kho/khuyến mãi đúng một lần và không cộng điểm; 10 request với key mới thanh toán lại cùng orderId chỉ giữ lại một lần, tạo đúng một Payment thành công và một EARN; replay key FAIL cũ không đảo ngược trạng thái PAID hiện tại |

Request cạnh tranh có thể trả `409 IDEMPOTENCY_IN_PROGRESS` với `Retry-After: 1`; test chỉ chấp nhận lỗi này, không bỏ qua các lỗi khác. Sau khi batch kết thúc, retry cùng key/payload phải trả snapshot gốc và `Idempotency-Replayed: true`. Mọi response thành công trong batch phải có cùng body, chỉ một response có header replay false.

## Bằng chứng bổ trợ

- `idempotency.e2e-spec.ts`: canonical hash, phân biệt user/scope, key sai định dạng, payload xung đột, rollback/retry; test PostgreSQL thật cho lock timeout và unique constraint. Suite này có mock ở các port nghiệp vụ nên được bổ sung bằng ba test HTTP đầy đủ bên trên.
- Các test checkout có sẵn kiểm tra replay tuần tự, rollback key cùng nghiệp vụ khi hết kho, FAIL/retry, hủy và đảo điểm.
- Baseline tại `business-rules.md` §7 và `docs/api/README.md`: key UUID, unique `(userId, scope, key)`, PROCESSING và nghiệp vụ cùng transaction, không TTL/reclaim trong MVP, replay trước kiểm tra lại trạng thái nghiệp vụ. Timeout kỹ thuật retry cùng key; retry sau FAIL dùng key mới trên cùng đơn.

## Chạy kiểm thử

```powershell
docker compose up -d db
npm run test:db
npm run lint
npm run build
npm run api:check
npm run docs:check
```

`test:db` tạo database tạm để chạy toàn bộ suite, các suite tự cách ly có database riêng; tự migrate và xóa sau khi kết thúc. Không chạy seed trên database phát triển để nghiệm thu.

Đóng Issue #11 sau khi PR bổ sung test đã được một thành viên khác review, CI đạt và merge. Link PR/CI và số liệu kiểm thử được ghi trong mô tả PR để gắn với đúng commit.

## Kết quả local — 25/10/2026

- `npm run test:db`: 22 suite backend, 385/385 test; frontend 35/35 test, không bỏ qua. Database tạm được xóa khi lệnh kết thúc.
- Sau khi bind HTTP server một lần trước batch đồng thời để tránh Supertest tự listen cạnh tranh: chạy lại riêng checkout trên database tạm đạt 9/9 test, không cảnh báo listener.
- API types và docs contract checks đạt; không thay đổi contract, schema, migration hay runtime service.
- Lệnh build mặc định gặp lỗi Turbopack khi khởi động tiến trình PostCSS trên Windows local; kết quả build mặc định trên CI phải được xác nhận riêng trong PR.
