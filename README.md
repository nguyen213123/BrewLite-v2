# BrewLite

Khung khởi đầu cho nhóm 6 người: Next.js App Router + TypeScript + TailwindCSS, NestJS, Prisma và PostgreSQL. Hiện có trang chào, nút kiểm tra kết nối API, health check, migration nền, Docker Compose và CI. Các module nghiệp vụ được giao cho 5 thành viên theo [kế hoạch](docs/requirements/rebuild-plan.md).

Trước khi code module, đọc [bàn giao issue #1](docs/requirements/team-handoff.md), [quy tắc nghiệp vụ](docs/requirements/business-rules.md), [ERD](docs/diagrams/erd.md) và [hợp đồng API](docs/api/README.md). OpenAPI/fixture mô tả các endpoint cần triển khai tiếp; hiện runtime chỉ có health check.

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

Chỉ sao chép env trong lần đầu; giữ cấu hình riêng nếu file đã tồn tại. Nếu PostgreSQL được cài riêng, bỏ lệnh Docker và sửa DATABASE_URL trong `backend/.env`.

- Frontend: http://localhost:3000
- API liveness: http://localhost:3001/api/health
- API/database readiness: http://localhost:3001/api/health/ready

Nhấn **Kiểm tra backend** trên trang chủ để kiểm tra kết nối từ trình duyệt. Có thể chạy riêng bằng `npm --prefix frontend run dev` và `npm --prefix backend run start:dev` trong hai terminal.

## Chạy toàn bộ bằng Docker

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f
```

Backend tự áp dụng migration đã commit trước khi chạy. `docker compose down` dừng các dịch vụ, dữ liệu database được giữ trong volume. Các thông tin đăng nhập mẫu chỉ dùng ở local. Khi chạy bằng Docker, cấu hình nằm trong compose.yaml; thay đổi NEXT_PUBLIC_API_URL cần build lại frontend vì giá trị được nhúng lúc build.

## Lệnh chung

| Lệnh | Công dụng |
| --- | --- |
| `npm run dev` | Chạy frontend và backend, Ctrl+C dừng cả hai |
| `npm run lint` | ESLint cho hai ứng dụng |
| `npm run build` | Generate Prisma client và build hai ứng dụng |
| `npm test` | Kiểm thử HTTP health endpoints với database giả lập |
| `npm run db:generate` | Sinh Prisma client sau khi đổi schema |
| `npm run db:migrate -- --name ten_thay_doi` | Tạo và áp dụng migration khi phát triển |
| `npm --prefix backend run prisma:deploy` | Áp dụng migration đã commit |
| `npm run db:studio` | Mở Prisma Studio |

Các lệnh Prisma chạy trong backend và đọc `backend/.env`. Client được sinh vào `backend/src/generated/prisma`, không commit. Commit schema, migration và ba package-lock.json. Sau khi cài lại, chạy db:generate trước npm test; build/dev đã tự generate.

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

Tạo module nghiệp vụ trong `backend/src/modules/<module>/` và phần frontend tương ứng khi nhận việc. Không dựng sẵn JWT, Zustand, catalog hoặc payment trong bước khung nền; thành viên thêm dependency cần thiết cùng module mình phụ trách.

Mỗi tính năng có nhánh riêng, PR và ít nhất một người khác review. Cập nhật docs/api và phối hợp migration khi thay đổi contract/schema. CI kiểm tra lint, test, build và kết nối database thật qua PostgreSQL service. Quy tắc bắt buộc review/CI cần được bật trong cài đặt GitHub khi tạo repository.

## Xử lý lỗi thường gặp

- Readiness trả 503: kiểm tra Docker Desktop, `docker compose ps db` và DATABASE_URL.
- Cổng bị chiếm: dừng tiến trình cũ hoặc đổi port đồng bộ trong env, Compose và URL frontend.
- Không tìm thấy Prisma client: chạy `npm run db:generate`.
- Frontend không kết nối API: kiểm tra NEXT_PUBLIC_API_URL, FRONTEND_URL và khởi động lại dev server sau khi sửa env.

Tham khảo cấu hình nền: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [NestJS first steps](https://docs.nestjs.com/first-steps), [Prisma PostgreSQL](https://www.prisma.io/docs/orm/overview/databases/postgresql).
