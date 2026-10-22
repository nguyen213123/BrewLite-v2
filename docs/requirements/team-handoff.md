# Bàn giao baseline issue #1 cho nhóm 6 người

## Đọc trước khi code

1. [Business rules](business-rules.md): công thức tiền, phạm vi MVP, State Machine, transaction.
2. [ERD](../diagrams/erd.md) và [Prisma reference](../diagrams/schema.prisma): bảng và người sở hữu.
3. [OpenAPI](../api/openapi.yaml) và [fixture](../api/examples.json): JSON dùng chung, không tự đổi tên field.

Baseline v1.0.0 chốt kỹ thuật để bắt đầu phát triển; cần review bởi đại diện nhóm qua PR trước khi merge. Chưa có ai được coi là đã review chỉ vì có tên TV1–TV5 dưới đây. Trưởng nhóm gán GitHub account thật khi mời đủ thành viên.

## Phân công đã cân bằng

| Người | Issue | Sản phẩm và trách nhiệm |
| --- | --- | --- |
| Bạn/trưởng nhóm | #1, #16; Task 1 đã có khung | Review baseline, điều phối schema/migration, CI/Compose, nghiệm thu, Sprint docs |
| TV1 | #2, #3, #14 | Catalog + seed, trang chi tiết, tính/validate mã khuyến mãi; phối hợp counter trong transaction |
| TV2 | #4, #5, #13 | Menu/cart/badge/checkout, UI ưu đãi/điểm; failed payment giữ giỏ; Idempotency-Key theo thao tác |
| TV3 | #7, #8, #9 | Order/quote, snapshot, đủ State Machine, stock optimistic locking, cancel và transaction chung |
| TV4 | #6, #12, #15 | JWT/user/guards/error envelope/CORS; API đọc order và UI xác nhận/lịch sử; loyalty EARN/REVERSE |
| TV5 | #10, #11 | Mock payment, idempotency CREATE_ORDER/PAY_ORDER và phối hợp test đồng thời |

Task 9 gồm UI/API của TV4 và Compose/README/demo của trưởng nhóm cùng toàn đội. Task 10 gồm TV3 state/stock, TV5 idempotency, TV1 khuyến mãi, TV4 điểm. Số issue không phải thước đo ngang bằng độ khó.

## Ranh giới code để không giẫm nhau

- TV1 cung cấp pricing catalog/promotion nhận Prisma transaction client từ caller. Không tự commit lượt ưu đãi trong một transaction riêng.
- TV3 sở hữu OrderModule, `assertTransition`, quote/create/cancel và hàm transition có optimistic version; cung cấp service đọc theo chủ user cho TV4. TV4 thêm controller đọc trong `backend/src/modules/order-history/`, không sửa OrderController của TV3; thống nhất route trong OpenAPI. OrderModule export service đọc, OrderHistoryModule import nó; tại AppModule tích hợp phải kiểm tra route tĩnh GET /orders/me được đăng ký trước GET /orders/:id. TV3 không khai báo trùng route /me; thêm integration test /me không bị bắt thành id.
- TV4 cung cấp JwtAuthGuard, StaffGuard, CurrentUser và loyalty service nhận transaction client; controller không tự truy cập đơn theo ID thiếu userId.
- TV5 cung cấp idempotency service wrapper nhận callback transaction, dùng được cho cả create order và payment. TV3 gọi wrapper CREATE_ORDER; TV5 gọi PAY_ORDER. Dịch vụ payment gọi transition/stock/promo/loyalty trong cùng unit-of-work.
- Frontend TV1 làm product detail; TV2 sở hữu cart store và checkout, xuất hàm addItem dùng chung; TV4 làm auth provider, login/register, confirmation/history; TV5 làm phần chọn phương thức/kết quả mock qua callback của checkout. TV5 không tạo thêm một checkout page độc lập.
- Khung đường dẫn FE đề xuất thống nhất: `/` menu, `/products/[id]`, `/cart`, `/checkout`, `/login`, `/register`, `/orders`, `/orders/[id]` (đồng thời là xác nhận). TV2 thay trang chào khi menu sẵn sàng.
- Mọi thay đổi `app.module.ts`, setup.ts, env.example, package-lock và schema/migration phải phối hợp review với chủ module hoặc trưởng nhóm. Không copy service dùng chung sang module khác.

## Thứ tự mở PR và tích hợp

1. Review/merge PR tài liệu issue #1, chạy docs:check. Mọi người có thể làm UI/DTO theo fixture trong khi chờ baseline DB.
2. TV3 mở PR schema nền: copy các enum/model đã chốt từ schema tham chiếu, giữ generator runtime, tạo migration và CHECK/index theo ERD. Các chủ bảng review cùng một baseline; chạy migrate trên PostgreSQL mới.
3. TV1 catalog/seed (#2), TV4 auth/error filter (#6), TV5 idempotency nền (#11) triển khai song song. TV2 menu/cart dùng fixture rồi nối catalog; TV1 detail tích hợp cart qua interface chung.
4. TV3 nối order/stock/state (#7–9) vào schema/auth/catalog/idempotency; TV1 cung cấp promo, TV4 loyalty theo interface transaction ngay cả khi UI chưa xong.
5. TV5 payment (#10), TV4 history (#12), TV2 checkout (#13) tích hợp trên API thật. TV5 phối hợp TV3 kiểm thử request lặp/đồng thời; không giữ mock fixture làm nguồn dữ liệu nghiệm thu.
6. Sprint 3 hoàn thiện #14/#15, kiểm thử biên, giá/khuyến mãi/điểm/tồn, demo cả hai nhánh thanh toán và bàn giao #16.

Issue #11 có thể mở PR hạ tầng idempotency trước payment; nghiệm thu cuối của #11 vẫn cần payment/order thật. Không coi liên kết phối hợp trong issue là bắt buộc chờ toàn bộ issue kia đóng mới được code, tránh vòng chờ.

## Checklist review baseline

- [ ] TV1 xác nhận size/topping, giá S và contract mã giảm giá.
- [ ] TV2 xác nhận CartItem/Quote/Order/PaymentResult đủ để làm UI và retry an toàn.
- [ ] TV3 xác nhận ERD, CHECK/index, State Machine, stock/version và unit-of-work.
- [ ] TV4 xác nhận JWT/quyền, API đọc order, error envelope và EARN/REVERSE.
- [ ] TV5 xác nhận header/hash/replay, payment FAIL/SUCCESS và một transaction checkout.
- [ ] Trưởng nhóm xác nhận các quyết định thiết kế nằm trong phạm vi đề và lên lịch Sprint 1.

Nhóm cập nhật checklist sau khi thực sự review. Không cần chờ backend hoàn chỉnh để dựng UI theo fixture, nhưng chỉ merge schema/API thay đổi contract sau review chung.
