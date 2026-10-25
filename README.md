# BrewLite

## Luồng đặt hàng và thanh toán

Trên `main`: `/` hoặc `/menu` → chọn sản phẩm/size/topping → `/cart` → `/checkout` → lịch sử đơn và điểm thưởng. `/payments` chuyển đến checkout; giao diện demo cũ được giữ tại `/payments/demo`.

Backend dùng PostgreSQL thật để tính giá, giữ/trả kho và lượt khuyến mãi, lưu đơn/thanh toán và cộng/đảo điểm. Gateway Ví/Thẻ là mô phỏng theo phạm vi bài tập, không thu tiền thật.

Sau khi cài dependencies và cấu hình env theo phần bên dưới:

```powershell
docker compose up -d db
npm --prefix backend run prisma:deploy
npm --prefix backend run build
npm --prefix backend run build:seed
npm --prefix backend run seed
npm run dev
```

Seed dùng ID/mã cố định, gồm 17 sản phẩm, 5 topping, size S/M/L và 3 mã khuyến mãi. Chạy lại không nhân bản dữ liệu, **nhưng đặt lại stock/version sản phẩm và usedCount khuyến mãi về dữ liệu demo**. Chỉ seed database demo có thể đặt lại; không chạy trên dữ liệu cần giữ.

Đăng ký tài khoản rồi chọn Cappuccino M + Kem × 2 và mã `SAVE10`: subtotal 120.000đ, giảm 12.000đ, tổng 108.000đ. Chọn kịch bản SUCCESS để nhận 10 điểm; FAIL trả kho/lượt mã và giữ giỏ. Sau FAIL có thể thử lại cùng đơn bằng khóa mới. Hủy PAID trước pha chế hoàn kho/lượt mã và đảo điểm.

Checkout lưu yêu cầu theo tài khoản trong sessionStorage trước khi POST. Lỗi mạng/tải lại trang giữ cùng Idempotency-Key và dữ liệu; phải xác minh trạng thái đơn trước khi tiếp tục. Chỉ trừ các dòng đã mua sau GET xác nhận PAID/PREPARING/READY/COMPLETED, không trừ hai lần khi replay, không xóa món vừa thêm lại. Hoàn tất/hủy đơn cũ trước khi bắt đầu đơn mới. Đơn PENDING chưa có cơ chế tự hết hạn: dùng nút hủy nếu không tiếp tục.

```powershell
npm test          # Backend + test cart/checkout frontend; DB suite mặc định bỏ qua
npm run test:db   # Toàn bộ test trên PostgreSQL tạm, tự migrate và xóa database sau test
npm run lint
npm run build
```

`test:db` yêu cầu PostgreSQL localhost có tài khoản CREATEDB (Docker Compose mặc định đã có). Lệnh không seed hoặc sửa database phát triển. Xem [kịch bản nghiệm thu checkout](docs/requirements/checkout-integration.md).

## Nghiệm thu và bàn giao

[Ma trận và kết quả nghiệm thu](docs/qa/final/README.md), [bằng chứng Menu desktop/mobile](docs/qa/issue-4/README.md) và [checklist chạy từ clone mới](docs/qa/final/human-signoff.md) được lưu cùng mã nguồn. Hồ sơ kỹ thuật không thay cho xác nhận demo/review của thành viên.

Để kiểm tra trên Docker sạch mà không sửa database/env phát triển:

```powershell
npm run qa:up          # build, migrate, seed database QA tmpfs riêng; UI 3400 / API 3401
npm run qa:benchmark   # đo latency trên QA, lưu docs/qa/final/latency.json
npm run qa:down        # xóa riêng container/network và dữ liệu QA
```

QA dùng dữ liệu có thể bỏ; chạy lại `qa:up`/seed đặt lại dữ liệu mẫu. Các cổng 3400/3401 phải còn trống. Cổng PostgreSQL QA không được publish. Không dùng tài khoản hoặc dữ liệu thật trong QA. Gateway mock, đơn PENDING không tự hết hạn, chưa đồng bộ checkout đa tab theo phạm vi MVP.

Dự án cho nhóm 6 người: Next.js App Router + TypeScript + TailwindCSS, NestJS, Prisma và PostgreSQL; gồm catalog, giỏ hàng, checkout, xác thực, đơn hàng, thanh toán mô phỏng, khuyến mãi và điểm thưởng. Có health check, schema/migration ERD, Docker Compose và CI. Phân công module theo [kế hoạch](docs/requirements/rebuild-plan.md).

Trước khi code module, đọc [hướng dẫn bộ khung API](docs/api/skeleton.md), [bàn giao issue #1](docs/requirements/team-handoff.md), [quy tắc nghiệp vụ](docs/requirements/business-rules.md), [ERD](docs/diagrams/erd.md) và [hợp đồng API](docs/api/README.md). API tuân theo OpenAPI; endpoint bảo vệ thiếu Bearer trả 401. Thanh toán dùng gateway mô phỏng, hiệu ứng nghiệp vụ được lưu trên PostgreSQL.

## Yêu cầu

- Node.js 24 LTS và npm.
- Docker Desktop đang chạy Linux containers, hoặc PostgreSQL 17 riêng.
- Cổng mặc định: frontend 3000, backend 3001, PostgreSQL 5432.

## Chạy để phát triển (PowerShell)

Tại thư mục gốc:

```powershell
npm ci
npm run setup
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
docker compose up -d db
npm --prefix backend run prisma:deploy
npm run dev
```

Chỉ sao chép env trong lần đầu; giữ cấu hình riêng nếu file đã tồn tại. Sau khi sao chép `backend/.env`, mở file và thiết lập `JWT_SECRET` với độ dài tối thiểu 32 ký tự (backend bắt buộc kiểm tra secret này khi khởi động và sẽ từ chối chạy nếu thiếu hoặc ngắn hơn 32 ký tự).

Tạo chuỗi ngẫu nhiên tối thiểu 32 ký tự:
- PowerShell:
  ```powershell
  -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
  ```
- Linux / macOS / Git Bash:
  ```bash
  openssl rand -hex 32
  ```

Nếu PostgreSQL được cài riêng, bỏ lệnh Docker và sửa DATABASE_URL trong `backend/.env`.

- Frontend: http://localhost:3000
- API liveness: http://localhost:3001/api/health
- API/database readiness: http://localhost:3001/api/health/ready

Mở trang chủ để xem menu sau khi seed. Kiểm tra API/database tại các URL health bên trên. Có thể chạy riêng bằng `npm --prefix frontend run dev` và `npm --prefix backend run start:dev` trong hai terminal.

## Chạy toàn bộ bằng Docker

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f
```

Backend tự áp dụng migration đã commit trước khi chạy. Backend container tự động nạp `JWT_SECRET` qua `env_file` từ `backend/.env` (hoặc `.env` ở thư mục gốc); hãy đảm bảo `backend/.env` đã có `JWT_SECRET` (tối thiểu 32 ký tự) trước khi khởi động. `docker compose down` dừng các dịch vụ, dữ liệu database được giữ trong volume. Project tên `brewlite-v2` để không tái sử dụng volume của BrewLite cũ. Nếu trước đây chạy project `brewlite`, dừng container db cũ đang chiếm cổng trước khi chạy v2; không xóa/reset volume cũ. Các thông tin đăng nhập mẫu chỉ dùng ở local. Khi chạy bằng Docker, cấu hình nằm trong compose.yaml; thay đổi NEXT_PUBLIC_API_URL cần build lại frontend vì giá trị được nhúng lúc build.

## Lệnh chung

| Lệnh | Công dụng |
| --- | --- |
| `npm run dev` | Chạy frontend và backend, Ctrl+C dừng cả hai |
| `npm run lint` | ESLint cho hai ứng dụng |
| `npm run build` | Generate Prisma client và build hai ứng dụng |
| `npm test` | Kiểm thử HTTP/DTO/guard/State Machine; DB integration opt-in qua RUN_DB_TESTS=1 |
| `npm run api:types` | Sinh TypeScript type từ OpenAPI cho backend/frontend |
| `npm run api:check` | Kiểm tra type sinh tự động khớp contract |
| `npm run db:generate` | Sinh Prisma client sau khi đổi schema |
| `npm run db:migrate -- --name ten_thay_doi` | Tạo và áp dụng migration khi phát triển |
| `npm --prefix backend run prisma:deploy` | Áp dụng migration đã commit |
| `npm run db:studio` | Mở Prisma Studio |
| `npm --prefix backend run build:seed` | Biên dịch riêng seed script |
| `npm --prefix backend run seed` | Nạp hoặc cập nhật dữ liệu mẫu |

Các lệnh Prisma chạy trong backend và đọc `backend/.env`. Client được sinh vào `backend/src/generated/prisma`, không commit. Commit schema, migration và ba package-lock.json. Sau khi cài lại, chạy db:generate trước npm test; build/dev đã tự generate.

## Nạp dữ liệu mẫu (Seed)

Sau khi cấu hình `backend/.env` và cài dependencies, chạy các lệnh sau tại thư mục gốc project:

```powershell
npm --prefix backend run prisma:deploy
npm --prefix backend run build
npm --prefix backend run build:seed
npm --prefix backend run seed
```

Seed tạo hoặc cập nhật 17 sản phẩm, 5 topping, các kích thước sản phẩm và 3 mã khuyến mãi. Chạy lại seed không tạo thêm bản ghi trùng đối với các dữ liệu được đồng bộ bằng ID hoặc mã cố định.

**Lưu ý:** Mỗi lần chạy seed, tồn kho (`stock`) của sản phẩm và số lượt sử dụng (`usedCount`) của khuyến mãi được đặt lại về giá trị mẫu. Không chạy seed trên database có dữ liệu cần giữ nếu chưa sao lưu.

Seed cũng đặt lại tên, giá, mô tả, ảnh, size và topping của các sản phẩm trong danh sách seed về giá trị mẫu; không xóa đơn hàng và không xóa sản phẩm hay mã ngoài danh sách seed.

## Cấu trúc và cách đóng góp

```text
frontend/src/app/        Trang và layout
frontend/src/lib/        Tiện ích client, API helper
backend/src/health/      Liveness và readiness
backend/src/prisma/      PrismaService dùng chung
backend/prisma/          Schema và migration
backend/test/            Kiểm thử HTTP
docs/requirements/      Yêu cầu, kế hoạch, phân công
docs/api/               Hợp đồng API
docs/sprints/           Planning, Review, Retrospective
docs/diagrams/          Kiến trúc, ERD, Use Case
.github/workflows/      CI
```

Các module nghiệp vụ nằm trong `backend/src/modules/`. Controller/DTO và các port trong `backend/src/common/contracts/ports.ts` là điểm tích hợp chung; thay đổi module cần giữ transaction, guard và hợp đồng API. Không đưa fixture vào runtime để trả success giả.

Mỗi tính năng có nhánh riêng, PR và ít nhất một người khác review. Cập nhật docs/api và phối hợp migration khi thay đổi contract/schema. CI kiểm tra lint, test, build và kết nối database thật qua PostgreSQL service. Quy tắc bắt buộc review/CI cần được bật trong cài đặt GitHub khi tạo repository.

## Xử lý lỗi thường gặp

- Backend không khởi động / ném lỗi `JWT_SECRET must be configured with at least 32 characters`: Mở `backend/.env` và thiết lập `JWT_SECRET` với độ dài từ 32 ký tự trở lên.
- Readiness trả 503: kiểm tra Docker Desktop, `docker compose ps db` và DATABASE_URL.
- Cổng bị chiếm: dừng tiến trình cũ hoặc đổi port đồng bộ trong env, Compose và URL frontend.
- Không tìm thấy Prisma client: chạy `npm run db:generate`.
- Frontend không kết nối API: kiểm tra NEXT_PUBLIC_API_URL, FRONTEND_URL và khởi động lại dev server sau khi sửa env.

Tham khảo cấu hình nền: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [NestJS first steps](https://docs.nestjs.com/first-steps), [Prisma PostgreSQL](https://www.prisma.io/docs/orm/overview/databases/postgresql).
