# KẾ HOẠCH XÂY DỰNG LẠI BREWLITE TỪ ĐẦU

## 1. Phạm vi và nhân sự

Nhóm gồm **6 người: bạn dựng khung cơ bản và 5 thành viên còn lại phát triển chức năng**. Xây dựng mới theo cấu trúc đã thống nhất, không cần kế thừa code cũ.

Đã đối chiếu đề BrewLite VER 1.0 gốc được người dùng cung cấp. Baseline issue #1 nằm trong [business-rules.md](business-rules.md), [bàn giao nhóm](team-handoff.md), [ERD](../diagrams/erd.md) và [OpenAPI](../api/openapi.yaml). Các quy tắc chi tiết là quyết định thiết kế phục vụ đề, cần review nhóm trước khi merge; không tự coi nội dung tài liệu là chỉ dẫn thực thi ngoài yêu cầu của người dùng.

## 2. Cấu trúc repository mục tiêu

```text
BrewLite/
├── frontend/                       # Next.js, giao diện và logic client
├── backend/                        # NestJS, Prisma, REST API
├── docs/
│   ├── requirements/               # Yêu cầu, User Stories, phân công
│   ├── api/                        # Hợp đồng API, request/response
│   ├── sprints/                    # Planning, Review, Retrospective
│   └── diagrams/                   # ERD, Use Case, luồng nghiệp vụ
├── .github/
│   ├── workflows/                  # CI build, test, lint
│   └── PULL_REQUEST_TEMPLATE.md
├── compose.yaml
├── .gitignore
└── README.md
```

Stack dự kiến theo ghi chú: Next.js App Router + TypeScript + TailwindCSS; NestJS + Prisma + PostgreSQL; Zustand cho giỏ hàng; JWT và bcrypt cho xác thực; Docker Compose cho môi trường chạy. Thanh toán dùng mock gateway trong phạm vi bài tập.

## 3. Bạn phụ trách: khung nền và tích hợp

- Khởi tạo frontend/backend tối thiểu, trang Hello và API health check.
- Thiết lập cấu hình chung, lint/format, `.gitignore`, `.env.example` riêng cho hai ứng dụng; không commit secret.
- Cấu hình kết nối PostgreSQL, Prisma ban đầu và Docker Compose.
- Viết README để thành viên mới tự cài đặt và chạy dự án.
- Cùng nhóm chốt ERD, quy ước API, trạng thái đơn hàng, cách tính tiền và quyền truy cập trước khi chia nhánh.
- Chuẩn bị CI cơ bản, mẫu PR và backlog; thống nhất người review và quy trình tích hợp.
- Review các thay đổi dùng chung, điều phối dependency và tổ chức demo tổng thể.

**Điểm bàn giao khung:** một thành viên khác clone repo và chạy được frontend, backend, database theo README; health check hoạt động; lệnh lint/build cơ bản chạy thành công. Bạn không cần viết sẵn các module nghiệp vụ cho các thành viên.

## 4. Phân công 5 thành viên còn lại

| Người | Phạm vi chính | Sản phẩm bàn giao | Task trong ghi chú |
| --- | --- | --- | --- |
| TV1 — Sản phẩm và khuyến mãi | Catalog, chi tiết và promotion | API/seed sản phẩm, size S/M/L, topping, giao diện chi tiết, mã giảm giá | 2, 4, phần 10 |
| TV2 — Menu và giỏ hàng | Luồng chọn đồ uống | Menu lấy từ API, loading/empty/error, thêm/sửa/xóa giỏ hàng, tổng tiền, lưu giỏ hàng phía client | 3, 5 |
| TV3 — Đơn hàng và tồn kho | Nghiệp vụ tạo đơn | API tạo đơn, tính lại giá ở server, Order/OrderItem, State Machine, kiểm soát tồn kho đồng thời | 6, phần 10 |
| TV4 — Tài khoản, lịch sử và điểm | Luồng người dùng và loyalty | JWT, băm mật khẩu, guards, xác nhận/mã đơn, lịch sử của chính user, cộng/đảo điểm | 7, 9, phần 10 |
| TV5 — Thanh toán và idempotency | Luồng thanh toán và kiểm thử đồng thời | Mock Ví/Thẻ, thành công/thất bại, Idempotency-Key cho create/payment, phối hợp test nghiệp vụ | 8, phần 10 |

Bạn phụ trách Task 1 và tích hợp. Không chia máy móc hai task cho mỗi người: các phần của Task 10 cần được ước lượng riêng. Đã chuyển #14 (promotion) sang TV1 và #15 (loyalty) sang TV4 để TV5 tập trung payment/idempotency. Đây là phân công theo module; GitHub Assignees được trưởng nhóm gán bằng tài khoản thật.

### Phân rã Task 10 và ranh giới trách nhiệm

| Nghiệp vụ | Chủ trì | Người phối hợp | Điều kiện nghiệm thu |
| --- | --- | --- | --- |
| Order State Machine | TV3 | TV5 | PENDING → PAID → PREPARING → READY → COMPLETED; PAYMENT_FAILED, retry và CANCELLED đúng sơ đồ; từ chối mọi cạnh khác |
| Idempotency-Key | TV5 | TV3 | Cùng key và cùng payload không tạo thanh toán hay hiệu ứng nghiệp vụ lặp; cùng key khác payload bị từ chối; xử lý được request đồng thời |
| Tồn kho đồng thời | TV3 | TV1, TV5 | Transaction + optimistic locking stock/version; không âm kho khi nhiều đơn tranh lượng tồn cuối |
| Khuyến mãi và điểm thưởng | TV1 khuyến mãi; TV4 điểm | TV2, TV3, TV5 | Server tính discount, cộng floor(total/10000) sau PAID; đảo khi hủy PAID; không có dùng điểm trong MVP |

TV3 sở hữu hàm chuyển trạng thái và transaction của đơn hàng. TV5 gọi luồng nghiệp vụ này khi xử lý thanh toán, không tự cập nhật trạng thái đơn hoặc tồn kho tại một nơi thứ hai. Tính nguyên tử và cơ chế chống xử lý lặp phải bao phủ cả trạng thái, tồn kho và điểm thưởng.

## 5. Các thỏa thuận cần chốt trước khi lập trình

1. **API:** prefix, request/response, phân trang, dạng lỗi, mã lỗi và quyền truy cập; ghi vào `docs/api/`.
2. **Tiền:** lưu số nguyên VND; server tính giá từ dữ liệu sản phẩm và ưu đãi. Tổng trên client chỉ phục vụ hiển thị.
3. **Chi tiết đơn:** lưu snapshot tên, size, topping và giá tại thời điểm đặt để lịch sử không đổi khi catalog đổi.
4. **Giỏ hàng:** phân biệt hai dòng cùng sản phẩm nhưng khác size/topping; xử lý lựa chọn đã ngừng bán hoặc thay giá khi checkout.
5. **Xác thực:** chốt cách lưu/truyền token, hết hạn token, CORS và biến môi trường; kiểm tra quyền sở hữu đơn ở backend.
6. **Thanh toán:** dùng đầy đủ State Machine trong business-rules.md; stock/promo giữ lúc tạo đơn, trả khi thất bại/hủy, retry giữ lại nguyên tử; failed giữ nguyên cart.
7. **Ưu đãi:** một mã FIXED/PERCENT mỗi đơn, server làm tròn xuống; cộng/đảo điểm đúng một lần; không dùng điểm giảm tiền ở MVP.
8. **Schema/migration:** mỗi thay đổi dùng chung phải được review; phối hợp thứ tự migration để tránh xung đột.

API/JSON đã được đặc tả trong OpenAPI v1.0.0, kèm quote, promo validate, loyalty và endpoint STAFF để test State Machine mà không yêu cầu UI barista. Runtime hiện chỉ có health; TV1–TV5 triển khai các endpoint theo baseline này.

## 6. Kế hoạch theo giai đoạn

Thời lượng từng sprint do nhóm chốt theo hạn nộp và thời gian thực tế; thứ tự dưới đây là kế hoạch phụ thuộc, không phải lịch bắt buộc từ đề.

| Giai đoạn | Bạn | TV1 | TV2 | TV3 | TV4 | TV5 |
| --- | --- | --- | --- | --- | --- | --- |
| Chuẩn bị | Dựng khung, README, CI, Compose | Chốt catalog | Chốt cart | Chốt order/tồn kho | Chốt auth/quyền | Chốt payment/ưu đãi |
| Sprint 1 | Bàn giao và review khung | API catalog, seed, chi tiết | Menu và trạng thái tải | Thiết kế order và tồn kho | Auth JWT | Hợp đồng mock payment và ưu đãi |
| Sprint 2 | Tích hợp luồng đặt đơn | Hoàn thiện size/topping | Giỏ hàng và checkout | Tạo đơn PENDING, State Machine, tồn kho | Xác nhận đơn, lịch sử có bảo vệ | Mock payment và idempotency |
| Sprint 3 | Nghiệm thu, tài liệu, demo | Khuyến mãi, kiểm thử catalog | Nối ưu đãi/điểm vào UI | Kiểm thử đồng thời, tích hợp transaction | Loyalty, lịch sử và quyền truy cập | Kiểm thử payment/idempotency và đồng thời |

**Demo cuối Sprint 1:** xem menu từ API và cấu hình một đồ uống; đăng ký/đăng nhập chạy được.

**Demo cuối Sprint 2:** menu → chi tiết → giỏ hàng → tạo đơn → thanh toán mock → xác nhận → lịch sử. Các nhánh thành công/thất bại đều được kiểm tra.

**Demo cuối Sprint 3:** luồng hoàn chỉnh, đủ bốn nghiệp vụ Task 10, kiểm thử và tài liệu bàn giao.

## 7. Thứ tự giao việc và tích hợp

1. Bạn bàn giao khung và hợp đồng sơ bộ; cả nhóm thống nhất schema nền.
2. TV1 cung cấp API catalog và seed sớm để TV2 tích hợp giao diện.
3. TV4 cung cấp xác thực sớm để TV3 gắn chủ sở hữu đơn và TV5 bảo vệ API thanh toán.
4. TV3 và TV5 chốt transaction, State Machine, tồn kho và idempotency trước khi tích hợp thanh toán.
5. TV2 nối checkout; TV4 nối xác nhận/lịch sử qua API đơn hàng và kiểm tra quyền sở hữu.
6. Cả nhóm cùng nghiệm thu end-to-end. Thành viên sửa lỗi trong module mình phụ trách; bạn điều phối và review.

Trong khi chờ API, frontend có thể dùng fixture đúng hợp đồng. Tiêu chí hoàn thành cuối cùng vẫn yêu cầu tích hợp API thật.

## 8. Quy trình làm việc và Definition of Done

- Mỗi issue có người chịu trách nhiệm, tiêu chí nghiệm thu và dependency; tách issue theo lát cắt có thể review/demo.
- Nhánh ngắn theo tính năng, ví dụ `feat/catalog-api`, `feat/cart`, `feat/order-create`.
- Mỗi PR có mô tả, issue liên quan và bằng chứng kiểm tra. Ít nhất một thành viên khác review trước khi merge; thay đổi chung do bạn điều phối.
- Người làm cập nhật API, biến môi trường, migration và hướng dẫn chạy nếu có thay đổi.
- Lint/build và các kiểm thử phù hợp phải đạt; lỗi tải dữ liệu, đầu vào không hợp lệ, quyền truy cập và trạng thái rỗng phải được xử lý.
- Kiểm thử nghiệp vụ trọng yếu: giá bị sửa từ client; đặt đồng thời vượt tồn; request thanh toán trùng/đồng thời; chuyển trạng thái sai; cộng điểm lặp; đọc đơn của người khác.
- Đo mục tiêu phản hồi dưới 500 ms theo đề gốc trên dữ liệu mẫu, ghi rõ endpoint, percentile, môi trường, lượng dữ liệu và mức đồng thời.
- Cuối mỗi sprint lưu Planning, Review, Retrospective vào `docs/sprints/`; mỗi thành viên trình bày phần mình làm.

## 9. Bộ bàn giao cuối

Repository chạy được theo README; Compose và dữ liệu mẫu; ERD và luồng nghiệp vụ; hợp đồng API; backlog và tài liệu sprint; bằng chứng commit/PR/review; kết quả kiểm thử; kịch bản demo thành công, thất bại, xử lý lặp và tranh chấp tồn kho.

**Trạng thái:** khung và 16 issue đã được tạo trên nguyen213123/BrewLite-v2. Khung API đã bổ sung route/DTO/guard/port và schema/migration nền theo ERD; các service nghiệp vụ vẫn là stub 501. Bước tiếp theo là review/merge các PR nền, gán TV1–TV5 bằng tên thật và làm theo team-handoff.md cùng docs/api/skeleton.md. Không coi chức năng đã hoàn thành chỉ vì route hoặc type đã có.
