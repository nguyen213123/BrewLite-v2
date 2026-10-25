# ☕ BrewLite Mộc Vị (v2) — Ứng Dụng Đặt Đồ Uống & Thanh Toán Không Tiền Mặt

**BrewLite** là hệ thống đặt trà sữa & cà phê trực tuyến theo mô hình thương mại điện tử hiện đại, tích hợp quản lý tồn kho theo thời gian thực (Optimistic Locking & Reservation), áp dụng mã khuyến mãi, thanh toán không tiền mặt an toàn với cơ chế chống gửi trùng (`Idempotency-Key`) và tích điểm thưởng khách hàng thân thiết (Loyalty Ledger).

Dự án được phát triển cho nhóm 6 thành viên với kiến trúc tách biệt Frontend / Backend rõ ràng, tuân thủ nghiêm ngặt hợp đồng OpenAPI 3.0 và kiểm thử tự động toàn diện trên PostgreSQL thật.

---

## 📑 Mục lục

1. [Kiến trúc & Công nghệ sử dụng](#-kiến-trúc--công-nghệ-sử-dụng)
2. [Hệ thống giao diện & Luồng đặt hàng](#-hệ-thống-giao-diện--luồng-đặt-hàng)
3. [Yêu cầu hệ thống](#-yêu-cầu-hệ-thống)
4. [Hướng dẫn cài đặt & Chạy phát triển (Quick Start)](#-hướng-dẫn-cài-đặt--chạy-phát-triển-quick-start)
5. [Nạp dữ liệu mẫu (Seed Data)](#-nạp-dữ-liệu-mẫu-seed-data)
6. [Chạy toàn bộ bằng Docker Compose](#-chạy-toàn-bộ-bằng-docker-compose)
7. [Kiểm tra & Xem dữ liệu Database](#-kiểm-tra--xem-dữ-liệu-database)
8. [Kiểm thử, Nghiệm thu & Bàn giao (QA)](#-kiểm-thử-nghiệm-thu--bàn-giao-qa)
9. [Bảng tra cứu lệnh chung](#-bảng-tra-cứu-lệnh-chung)
10. [Cấu trúc thư mục & Tài liệu thiết kế](#-cấu-trúc-thư-mục--tài-liệu-thiết-kế)
11. [Xử lý lỗi thường gặp (Troubleshooting)](#-xử-lý-lỗi-thường-gặp-troubleshooting)

---

## 🛠 Kiến trúc & Công nghệ sử dụng

| Tầng (Layer) | Công nghệ chính | Vai trò trong dự án |
| --- | --- | --- |
| **Frontend (`frontend/`)** | Next.js 16 (App Router), React 19, TypeScript, TailwindCSS v4, Zustand | Giao diện người dùng phong cách **Mộc Vị** (Xanh Mint Pastel `#cbe8d3`, Kem Cát `#faf6ec` / `#efe5d4`, Nâu Cà Phê `#6d4c3d`), lưu giỏ hàng bền vững (`localStorage`) và quản lý phiên thanh toán an toàn (`sessionStorage`). |
| **Backend (`backend/`)** | NestJS 11, TypeScript, Prisma ORM 7, Passport JWT, class-validator | Xử lý toàn bộ quy tắc nghiệp vụ: báo giá server-side, giữ/trả kho (`UnitOfWork` transaction), State Machine đơn hàng, Idempotency (`CREATE_ORDER`, `PAY_ORDER`), khuyến mãi và sổ cái điểm thưởng (`EARN` / `REVERSE`). |
| **Database (`db`)** | PostgreSQL 17 | Lưu trữ bền vững với ràng buộc toàn vẹn (`CHECK`, `UNIQUE`, khóa ngoại) và kiểm soát tranh chấp tồn kho/phiên bản đơn hàng. |
| **Hạ tầng & QA** | Docker Compose, GitHub Actions CI, OpenAPI / AJV Contract Check | Đóng gói đa container, kiểm tra hợp đồng API tự động và môi trường QA độc lập (`tmpfs`). |

---

## 🌿 Hệ thống giao diện & Luồng đặt hàng

### Các trang giao diện (Frontend Routes)

Toàn bộ các trang được thiết kế đồng bộ theo bảng màu **BrewLite Mộc Vị**:

| Đường dẫn (Route) | Trang chức năng | Mô tả chi tiết |
| --- | --- | --- |
| `/` hoặc `/menu` | **Trang chủ & Thực đơn** | Hero banner Mộc Vị, danh sách đồ uống phân trang (`GET /api/products`), bộ khung thẻ kem cát và giới thiệu thương hiệu. |
| `/products/[id]` | **Chi tiết đồ uống** | Chọn kích cỡ bắt buộc (`S` / `M` / `L`), chọn nhiều topping tùy ý, chỉnh số lượng theo tồn kho, tính giá tạm tính và thêm vào giỏ. |
| `/cart` | **Giỏ hàng** | Quản lý danh sách món đã chọn, gộp dòng cùng cấu hình, tăng/giảm số lượng (`1–99`), xem tạm tính và điểm thưởng dự kiến. |
| `/checkout` | **Thanh toán & Đặt đơn** | Tiến trình 3 bước: **(1)** Kiểm tra giỏ & Báo giá khuyến mãi → **(2)** Tạo đơn giữ hàng & Thanh toán mô phỏng Ví/Thẻ (`SUCCESS` / `FAIL`) → **(3)** Xác nhận kết quả & Tích điểm. |
| `/orders` | **Lịch sử đơn hàng** | Danh sách các đơn đã đặt của tài khoản (`GET /api/orders/me`), hiển thị trạng thái đơn, trạng thái giữ kho và mã ưu đãi. |
| `/orders/[id]` | **Chi tiết đơn hàng** | Snapshot chi tiết từng món/topping lúc đặt, tiếp tục thanh toán/hủy đơn; hỗ trợ nút chuyển trạng thái pha chế (`PREPARING` → `READY` → `COMPLETED`) cho tài khoản `STAFF`. |
| `/loyalty` | **Điểm thưởng Loyalty** | Xem tổng điểm hiện tại (`GET /api/loyalty/me`), quy tắc tích điểm (`10.000₫ = 1 điểm`) và sổ cái biến động điểm (`EARN` / `REVERSE`). |
| `/login`, `/register` | **Đăng nhập / Đăng ký** | Xác thực khách hàng & nhân viên bằng JWT Bearer token. |
| `/payments` | **Chuyển hướng thanh toán** | Tự động chuyển hướng về `/checkout` (giao diện showcase độc lập được giữ tại `/payments/demo`). |

### Quy tắc luồng đặt hàng & Thanh toán an toàn

1. **Hành trình chuẩn:** Mở `/` hoặc `/menu` → chọn sản phẩm/size/topping → `/cart` → `/checkout` → lịch sử đơn (`/orders`) và điểm thưởng (`/loyalty`).
2. **Xử lý phía Server:** Backend dùng PostgreSQL thật để tính giá, giữ/trả kho và lượt khuyến mãi, lưu đơn/thanh toán và cộng/đảo điểm. Gateway Ví (`WALLET`) / Thẻ (`CARD`) là cổng mô phỏng theo phạm vi bài tập, không thu tiền thật.
3. **Kịch bản kiểm thử mẫu:**
   - Đăng ký tài khoản rồi chọn **Cappuccino size M + Kem × 2** và nhập mã **`SAVE10`**: Tạm tính `120.000 ₫`, giảm `12.000 ₫`, tổng thanh toán **`108.000 ₫`**.
   - Chọn kịch bản **Thành công (`SUCCESS`)** để đơn chuyển sang `PAID`, trừ các món đã mua khỏi giỏ và nhận **`+10 điểm`**.
   - Chọn kịch bản **Thất bại (`FAIL`)**: Đơn chuyển sang `PAYMENT_FAILED`, hệ thống tự động trả lại kho & lượt mã khuyến mãi (`RELEASED`), đồng thời **giữ nguyên giỏ hàng**. Sau `FAIL`, người dùng có thể thử lại thanh toán trên cùng đơn bằng khóa `Idempotency-Key` mới.
   - **Hủy đơn `PAID` trước khi pha chế:** Hoàn trả tồn kho, hoàn lượt mã khuyến mãi và tự động ghi bút toán đảo điểm (`REVERSE`) trong sổ cái Loyalty.
4. **Bảo vệ Idempotency & Khôi phục phiên Checkout:**
   - Checkout lưu yêu cầu theo từng tài khoản trong `sessionStorage` trước khi gọi `POST`.
   - Nếu gặp lỗi mạng hoặc tải lại trang (F5), trình duyệt giữ nguyên cùng `Idempotency-Key` và payload; hệ thống bắt buộc xác minh trạng thái đơn (`GET /api/orders/:id`) trước khi tiếp tục.
   - Giỏ hàng chỉ trừ các dòng đã mua **sau khi `GET` xác nhận đơn đạt trạng thái `PAID` / `PREPARING` / `READY` / `COMPLETED`**, không bao giờ trừ hai lần khi replay và không xóa nhầm món người dùng vừa thêm mới sau khi tạo đơn.
   - Nếu tổng tiền của đơn vừa tạo khác với tổng đã báo giá (`quote`), hệ thống chặn thanh toán và yêu cầu người dùng xác nhận mức giá mới hoặc hủy đơn.
   - Hoàn tất hoặc hủy đơn cũ trước khi bắt đầu đơn mới (đơn `PENDING` trong phạm vi MVP chưa có cơ chế tự hết hạn theo thời gian: dùng nút hủy đơn nếu không tiếp tục).

---

## 💻 Yêu cầu hệ thống

- **Node.js:** Phiên bản `24 LTS` (`>=24 <25`) và `npm`.
- **Cơ sở dữ liệu:** Docker Desktop (chạy Linux containers) **hoặc** PostgreSQL 17 cài đặt riêng trên máy.
- **Cổng mạng mặc định:**
  - Frontend (Next.js): `http://localhost:3000`
  - Backend API (NestJS): `http://localhost:3001`
  - PostgreSQL Database: `localhost:5432`

---

## 🚀 Hướng dẫn cài đặt & Chạy phát triển (Quick Start)

Tại thư mục gốc của dự án (`c:\BrewLite_Assignment_1`), mở **PowerShell** và thực hiện tuần tự:

### Bước 1: Cài đặt thư viện & Sao chép file môi trường

```powershell
npm ci
npm run setup
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
```

> **Lưu ý quan trọng về `JWT_SECRET`:**
> Chỉ sao chép `.env` trong lần đầu tiên (giữ cấu hình riêng nếu file đã tồn tại). Sau khi tạo `backend/.env`, hãy mở file và thiết lập biến `JWT_SECRET` với **độ dài tối thiểu 32 ký tự** (Backend bắt buộc kiểm tra secret này khi khởi động và sẽ từ chối chạy nếu thiếu hoặc ngắn hơn 32 ký tự).
>
> Bạn có thể sinh nhanh chuỗi ngẫu nhiên 32 ký tự bằng:
> - **PowerShell:**
>   ```powershell
>   -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
>   ```
> - **Linux / macOS / Git Bash:**
>   ```bash
>   openssl rand -hex 32
>   ```

### Bước 2: Khởi chạy Database, Migrate, Seed dữ liệu và Chạy ứng dụng

```powershell
docker compose up -d db
npm --prefix backend run prisma:deploy
npm --prefix backend run build
npm --prefix backend run build:seed
npm --prefix backend run seed
npm run dev
```

*(Nếu bạn cài PostgreSQL riêng trên máy thay vì dùng Docker, hãy bỏ qua lệnh `docker compose up -d db` và cập nhật `DATABASE_URL` trong `backend/.env`).*

### Bước 3: Truy cập ứng dụng

- **Giao diện người dùng (Frontend):** [http://localhost:3000](http://localhost:3000)
- **Kiểm tra API Liveness:** [http://localhost:3001/api/health](http://localhost:3001/api/health)
- **Kiểm tra API & Database Readiness:** [http://localhost:3001/api/health/ready](http://localhost:3001/api/health/ready)

*(Bạn cũng có thể chạy riêng từng phần trong 2 cửa sổ terminal bằng `npm --prefix backend run start:dev` và `npm --prefix frontend run dev`).*

---

## 🌱 Nạp dữ liệu mẫu (Seed Data)

Lệnh nạp dữ liệu mẫu:

```powershell
npm --prefix backend run prisma:deploy
npm --prefix backend run build
npm --prefix backend run build:seed
npm --prefix backend run seed
```

- **Nội dung Seed:** Tạo hoặc cập nhật **17 sản phẩm đồ uống** (kèm hình ảnh thực tế tại `/images/*.jpg`), **5 loại topping**, đầy đủ **kích thước S / M / L** và **3 mã khuyến mãi**:
  - `SAVE10`: Giảm 10% (tối đa `30.000 ₫`, áp dụng cho đơn từ `50.000 ₫`).
  - `BREW20K`: Giảm trực tiếp `20.000 ₫` (áp dụng cho đơn từ `100.000 ₫`).
  - `FREETOPPING`: Giảm trực tiếp `10.000 ₫` (không yêu cầu giá trị đơn tối thiểu).
- **Tính chất Idempotent & Lưu ý:**
  - Seed sử dụng ID và mã cố định nên chạy lại nhiều lần **không nhân bản dữ liệu**, không xóa đơn hàng lịch sử và không xóa các sản phẩm/mã ngoài danh sách seed.
  - **Cảnh báo:** Mỗi lần chạy lại seed, tồn kho (`stock`), phiên bản (`version`) của sản phẩm mẫu và số lượt đã dùng (`usedCount`) của mã khuyến mãi sẽ được **đặt lại về giá trị demo ban đầu**. Chỉ chạy seed trên database phát triển/demo; không chạy trên môi trường có dữ liệu thật cần giữ.

---

## 🐳 Chạy toàn bộ bằng Docker Compose

Để đóng gói và chạy cả 3 dịch vụ (`db`, `backend`, `frontend`) trong Docker:

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f
```

- Container `backend` tự động áp dụng các bản migration đã commit trước khi khởi động server và nạp `JWT_SECRET` từ `backend/.env` (hoặc `.env` ở thư mục gốc). Hãy đảm bảo `JWT_SECRET` có tối thiểu 32 ký tự trước khi chạy.
- Dữ liệu PostgreSQL được lưu trong volume của project `brewlite-v2` (tách biệt hoàn toàn với volume cũ). Lệnh `docker compose down` chỉ dừng các dịch vụ mà không làm mất dữ liệu trong volume.
- Khi thay đổi `NEXT_PUBLIC_API_URL` trong [`compose.yaml`](compose.yaml), cần chạy lại kèm cờ `--build` vì biến môi trường của Next.js client được nhúng vào lúc build.

---

## 🗄 Kiểm tra & Xem dữ liệu Database

Bạn có thể kiểm tra trực tiếp dữ liệu trong PostgreSQL bằng 3 cách:

1. **Dùng Prisma Studio (Giao diện bảng trực quan trên trình duyệt — Khuyên dùng):**
   ```powershell
   npm run db:studio
   ```
   Trình duyệt sẽ mở tại **`http://localhost:5555`**, cho phép xem và lọc trực tiếp tất cả các bảng (`User`, `Product`, `ProductSize`, `Topping`, `Order`, `OrderItem`, `Payment`, `Promotion`, `LoyaltyLedger`, `IdempotencyRecord`).

2. **Dùng phần mềm quản lý DB (DBeaver, pgAdmin, TablePlus, DataGrip):**
   - **Host:** `localhost` | **Port:** `5432`
   - **Database:** `brewlite` | **Username:** `brewlite` | **Password:** `brewlite_dev`
   - **URL:** `postgresql://brewlite:brewlite_dev@localhost:5432/brewlite?schema=public`

3. **Dùng dòng lệnh `psql` trong Docker container:**
   ```powershell
   docker compose exec db psql -U brewlite -d brewlite
   ```

---

## ✅ Kiểm thử, Nghiệm thu & Bàn giao (QA)

### Chạy bộ kiểm thử tự động (Unit, E2E & Database Integration)

```powershell
npm test          # Chạy 14 suite Backend + 76 test Frontend (Cart, Pricing, Checkout, API Client)
npm run test:db   # Chạy toàn bộ 22 suite Backend (385 tests) trên PostgreSQL tạm, tự migrate và tự dọn DB sau khi xong
npm run lint      # Kiểm tra ESLint (0 warnings/errors) cho cả Backend và Frontend
npm run build     # Sinh Prisma Client và biên dịch Production cho cả hai ứng dụng
npm run docs:check # Kiểm tra tính hợp lệ của OpenAPI 3.0, 37 fixtures và đối chiếu Prisma Schema với ERD
npm run api:check  # Kiểm tra file TypeScript generated types khớp tuyệt đối với OpenAPI contract
```

*(Lưu ý: `npm run test:db` yêu cầu PostgreSQL tại `localhost:5432` có quyền `CREATEDB` — container Docker Compose mặc định đã cấp sẵn quyền này. Lệnh tạo database tạm riêng biệt nên hoàn toàn không chạm tới hay làm thay đổi dữ liệu trong database phát triển của bạn).*

### Chạy môi trường QA độc lập & Đo hiệu năng (Benchmark)

Để kiểm tra nghiệm thu trên môi trường Docker sạch mà không ảnh hưởng tới database hay file `.env` phát triển:

```powershell
npm run qa:up          # Build, migrate, seed trên database QA tmpfs riêng (UI cổng 3400 / API cổng 3401)
npm run qa:benchmark   # Đo độ trễ (latency p50/p95/max) trên stack QA, xuất kết quả ra docs/qa/final/latency.json
npm run qa:down        # Dọn dẹp riêng container, network và dữ liệu tạm của stack QA
```

- Các cổng `3400` và `3401` cần còn trống trước khi chạy `qa:up`. Cổng PostgreSQL của QA được cô lập nội bộ (không publish ra host).

### Hồ sơ nghiệm thu & Tài liệu kỹ thuật

- 📋 [Ma trận và kết quả nghiệm thu cuối kỳ](docs/qa/final/README.md)
- 📱 [Bằng chứng giao diện Menu Desktop/Mobile](docs/qa/issue-4/README.md)
- ✍️ [Checklist kiểm tra từ bản clone mới (Human Sign-off)](docs/qa/final/human-signoff.md)
- 🔄 [Kịch bản tích hợp & nghiệm thu Checkout](docs/requirements/checkout-integration.md)
- 📐 [Quy tắc nghiệp vụ cốt lõi (Business Rules)](docs/requirements/business-rules.md)
- 🗺 [Sơ đồ thực thể liên kết (ERD)](docs/diagrams/erd.md) & [Hợp đồng OpenAPI](docs/api/README.md)
- 👥 [Kế hoạch phân công & Bàn giao nhóm 6 người](docs/requirements/team-handoff.md)

---

## ⌨️ Bảng tra cứu lệnh chung

| Lệnh | Công dụng |
| --- | --- |
| `npm run dev` | Chạy đồng thời Backend (`:3001`) và Frontend (`:3000`), nhấn `Ctrl+C` để dừng cả hai |
| `npm run lint` | Kiểm tra quy chuẩn code (ESLint) cho cả hai ứng dụng |
| `npm run build` | Generate Prisma Client và build production cho Backend & Frontend |
| `npm test` | Kiểm thử HTTP, DTO, Guard, State Machine, Giỏ hàng và Checkout Session |
| `npm run test:db` | Kiểm thử tích hợp toàn diện (385 backend tests + 76 frontend tests) với PostgreSQL thật |
| `npm run api:types` | Sinh tự động TypeScript types từ `docs/api/openapi.yaml` cho Backend & Frontend |
| `npm run api:check` | Xác minh TypeScript types đã sinh khớp với hợp đồng OpenAPI |
| `npm run docs:check` | Xác minh OpenAPI schema, fixtures ví dụ và đồng bộ schema Prisma với tài liệu ERD |
| `npm run db:generate` | Sinh lại Prisma Client (`backend/src/generated/prisma`) sau khi cập nhật schema |
| `npm run db:migrate -- --name ten_thay_doi` | Tạo và áp dụng migration mới trong quá trình phát triển |
| `npm --prefix backend run prisma:deploy` | Áp dụng các bản migration đã commit vào database |
| `npm run db:studio` | Mở giao diện quản trị dữ liệu Prisma Studio tại `http://localhost:5555` |
| `npm --prefix backend run build:seed` | Biên dịch script nạp dữ liệu mẫu |
| `npm --prefix backend run seed` | Nạp hoặc khôi phục dữ liệu mẫu (17 sản phẩm, 5 topping, 3 mã khuyến mãi) |

---

## 📂 Cấu trúc thư mục & Tài liệu thiết kế

```text
BrewLite_Assignment_1/
├── frontend/
│   ├── public/images/         # Hình ảnh sản phẩm đồ uống thực tế
│   └── src/
│       ├── app/               # Các trang Next.js App Router (/, /menu, /products/[id], /cart, /checkout, /orders, /loyalty, /login, /register)
│       ├── components/        # Header, ProductCard, MenuGrid, Checkout, OrderStatusBadge, PaymentFlowWidget
│       ├── features/products/ # Logic tính giá tạm tính, kiểm tra cấu hình và giao diện chi tiết sản phẩm
│       └── lib/               # API helper, Auth store, Cart store (Zustand), Checkout session & hợp đồng kiểu OpenAPI
├── backend/
│   ├── prisma/                # Schema cơ sở dữ liệu, các bản migrations và seed script
│   ├── src/
│   │   ├── common/            # Contracts/Ports, UnitOfWork, Exception Filter, Guards (JWT, Staff, Idempotency)
│   │   ├── health/            # Endpoint kiểm tra Liveness (/api/health) và Readiness (/api/health/ready)
│   │   ├── modules/           # Các module nghiệp vụ: auth, products, orders, order-history, payments, promotions, loyalty, idempotency
│   │   └── prisma/            # PrismaService kết nối PostgreSQL dùng chung
│   └── test/                  # 22 bộ kiểm thử E2E & Integration
├── docs/
│   ├── api/                   # Hợp đồng OpenAPI (openapi.yaml), fixtures chuẩn (examples.json) và hướng dẫn khung API
│   ├── diagrams/              # Sơ đồ kiến trúc, ERD, Use Case và schema tham chiếu
│   ├── qa/                    # Bằng chứng kiểm thử, ảnh chụp nghiệm thu và kết quả đo hiệu năng (latency.json)
│   ├── requirements/          # Quy tắc nghiệp vụ, kế hoạch phát triển và phân công thành viên
│   └── sprints/               # Hồ sơ Sprint Planning, Review và Retrospective
├── scripts/                   # Công cụ tự động hóa: kiểm tra contract, sinh types, chạy QA stack và đo benchmark
└── compose.yaml               # Cấu hình Docker Compose cho PostgreSQL, Backend và Frontend
```

**Nguyên tắc đóng góp trong nhóm:**
- Các module nghiệp vụ nằm trong `backend/src/modules/`. Controller/DTO và các port trong `backend/src/common/contracts/ports.ts` là điểm tích hợp chung; mọi thay đổi cần giữ nguyên giao dịch (`UnitOfWork`), guard bảo vệ và hợp đồng OpenAPI.
- Không đưa dữ liệu giả (fixture) vào runtime để trả về kết quả thành công giả.
- Mỗi tính năng phát triển trên nhánh riêng, tạo Pull Request (PR), vượt qua toàn bộ kiểm tra CI (`lint`, `test`, `build`, `docs:check`, `api:check`) và có ít nhất một thành viên khác review trước khi merge vào `main`.

---

## 🔧 Xử lý lỗi thường gặp (Troubleshooting)

1. **Backend không khởi động và báo lỗi `JWT_SECRET must be configured with at least 32 characters`:**
   - Mở file `backend/.env` và điền giá trị cho `JWT_SECRET` có độ dài tối thiểu 32 ký tự (xem lệnh tạo nhanh ở phần [Hướng dẫn cài đặt](#-hướng-dẫn-cài-đặt--chạy-phát-triển-quick-start)).
2. **Endpoint `/api/health/ready` trả về lỗi `503 Service Unavailable`:**
   - Kiểm tra Docker Desktop đã bật chưa, chạy `docker compose ps db` để chắc chắn container PostgreSQL đang ở trạng thái `healthy` và kiểm tra lại chuỗi `DATABASE_URL` trong `backend/.env`.
3. **Lỗi xung đột cổng (`EADDRINUSE` trên cổng `3000`, `3001` hoặc `5432`):**
   - Dừng tiến trình hoặc container cũ đang chiếm cổng trước khi chạy, hoặc đổi cổng đồng bộ trong `backend/.env`, `frontend/.env.local` và `compose.yaml`.
4. **Lỗi không tìm thấy module Prisma Client (`Cannot find module '.../generated/prisma'`):**
   - Chạy lệnh `npm run db:generate` tại thư mục gốc để sinh lại Prisma Client.
5. **Frontend báo lỗi không thể kết nối đến máy chủ API:**
   - Kiểm tra Backend đã chạy ở cổng `3001` chưa, kiểm tra biến `NEXT_PUBLIC_API_URL=http://localhost:3001/api` trong `frontend/.env.local` và khởi động lại `npm run dev`.
