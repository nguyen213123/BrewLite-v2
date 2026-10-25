import Link from 'next/link';
import { MenuGrid } from '@/components/menu-grid';

export default function MenuPage() {
  return (
    <div>
      {/* Hero Banner Xanh Mint Pastel + Sóng Nâu Cà Phê chuẩn theo mẫu thiết kế */}
      <section className="relative overflow-hidden border-b border-[#b5dcc0] bg-[#cbe8d3]">
        {/* Dải sóng nâu nghệ thuật phía bên phải */}
        <svg
          className="pointer-events-none absolute top-0 right-0 hidden h-full w-[55%] text-[#6d4c3d] md:block"
          viewBox="0 0 600 420"
          fill="none"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M270 0H430C370 120 360 260 445 420H250C170 275 190 125 270 0Z"
            fill="currentColor"
          />
        </svg>

        {/* Hoạt tiết lá trà trang trí góc trái & phải */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-6 -left-6 h-28 w-44 rotate-[-15deg] rounded-full bg-[#a8d8b5]/60 blur-[1px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-8 left-8 h-24 w-36 rotate-[20deg] rounded-full bg-[#9fd2ae]/60"
        />

        <div className="relative mx-auto grid max-w-6xl items-center gap-8 px-6 py-10 md:grid-cols-[1.05fr_0.95fr] md:py-14">
          {/* Cột trái: Thông điệp & CTA */}
          <div className="relative z-10 max-w-xl space-y-4">
            <p className="text-base font-bold text-[#6d4c3d] sm:text-lg">
              BrewLite — Trà Sữa &amp; Cà Phê Mộc Vị
            </p>
            <h1 className="text-3xl leading-[1.15] font-extrabold tracking-tight text-[#4a2e20] sm:text-4xl lg:text-[42px]">
              Đặt Món Trực Tuyến,
              <br />
              Giao Hàng &amp; Nhận Nhanh
            </h1>
            <p className="max-w-md text-sm leading-relaxed text-[#5c4033]">
              Đặt món trực tuyến, giữ hàng tự động và thanh toán không tiền mặt tiện lợi. Nhập mã{' '}
              <strong className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs text-[#6d4c3d]">
                SAVE10
              </strong>{' '}
              giảm 10% hoặc{' '}
              <strong className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs text-[#6d4c3d]">
                BREW20K
              </strong>{' '}
              giảm 20.000₫.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <a
                href="#thuc-don-pho-bien"
                className="inline-flex items-center gap-2 rounded-full bg-[#6d4c3d] px-7 py-3 text-xs font-bold tracking-wide text-white shadow-sm transition hover:bg-[#563a2d]"
              >
                <span>Đặt Món Ngay</span>
              </a>
              <Link
                href="/cart"
                className="inline-flex items-center gap-2 rounded-full border-2 border-[#6d4c3d] bg-white/75 px-6 py-2.5 text-xs font-bold text-[#4a2e20] transition hover:bg-[#6d4c3d] hover:text-white"
              >
                <span>Xem Giỏ Hàng</span>
              </Link>
            </div>
          </div>

          {/* Cột phải: Cụm ly đồ uống chủ đạo & nguyên liệu */}
          <div className="relative z-10 flex items-end justify-center gap-3 sm:gap-4">
            {/* Ly 1: Trà sữa trân châu */}
            <div className="w-28 -rotate-3 overflow-hidden rounded-2xl border-2 border-white bg-[#efe5d4] p-1.5 shadow-lg sm:w-32">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/tra-sua.jpg"
                alt="Trà sữa trân châu"
                className="aspect-[3/4] w-full rounded-xl object-cover"
              />
              <p className="mt-1 text-center text-[10px] font-bold text-[#4a2e20]">
                Trà Sữa Trân Châu
              </p>
            </div>

            {/* Ly 2 (Chính giữa, cao hơn): Trà đào cam sả */}
            <div className="z-20 -mb-2 w-32 overflow-hidden rounded-2xl border-3 border-white bg-[#efe5d4] p-2 shadow-xl sm:w-40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/tra-dao.jpg"
                alt="Trà hoa quả nhiệt đới"
                className="aspect-[3/4] w-full rounded-xl object-cover"
              />
              <p className="mt-1.5 text-center text-xs font-extrabold text-[#4a2e20]">
                Trà Đào Nhiệt Đới
              </p>
            </div>

            {/* Ly 3: Matcha / Cappuccino */}
            <div className="w-28 rotate-3 overflow-hidden rounded-2xl border-2 border-white bg-[#efe5d4] p-1.5 shadow-lg sm:w-32">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/matcha.jpg"
                alt="Matcha Latte"
                className="aspect-[3/4] w-full rounded-xl object-cover"
              />
              <p className="mt-1 text-center text-[10px] font-bold text-[#4a2e20]">
                Matcha Kem Cheese
              </p>
            </div>
          </div>
        </div>

        {/* Chấm tròn chỉ báo slider phía dưới */}
        <div className="relative z-10 flex items-center justify-center gap-2 pb-4" aria-hidden="true">
          <span className="size-2 rounded-full bg-[#6d4c3d]" />
          <span className="size-2 rounded-full bg-[#6d4c3d]/35" />
          <span className="size-2 rounded-full bg-[#6d4c3d]/35" />
        </div>
      </section>

      {/* Khu vực Thực Đơn Phổ Biến */}
      <main id="thuc-don-pho-bien" className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-10 text-center">
          <p className="eyebrow">Hương vị tươi mới mỗi ngày</p>
          <h2 className="mt-1.5 text-2xl font-extrabold tracking-tight text-[#4a2e20] sm:text-3xl">
            Thực Đơn Phổ Biến
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[#7a6254]">
            Chọn món đồ uống yêu thích, tùy chỉnh kích cỡ S/M/L cùng các loại topping hấp dẫn.
          </p>
        </div>

        <MenuGrid />
      </main>

      {/* Dải băng "Về Chúng Tôi" nền Xanh Mint Pastel phía trên Footer giống mẫu */}
      <section className="border-t border-[#b5dcc0] bg-[#cbe8d3] px-6 py-14 text-center">
        <div className="mx-auto max-w-3xl space-y-4">
          <h2 className="text-2xl font-extrabold text-[#4a2e20] sm:text-3xl">Về Chúng Tôi</h2>
          <p className="text-sm leading-relaxed text-[#4a2e20]/85">
            BrewLite Mộc Vị mang đến trải nghiệm đặt trà sữa và cà phê thủ công trực tuyến hiện đại:
            nguyên liệu trà tươi &amp; hạt cà phê rang mộc tuyển chọn, hệ thống báo giá &amp; giữ tồn kho
            theo thời gian thực, thanh toán không tiền mặt an toàn và chương trình tích điểm thưởng
            Loyalty minh bạch cho từng đơn hàng.
          </p>
          <div className="pt-2">
            <Link
              href="/loyalty"
              className="inline-flex items-center justify-center rounded-full bg-[#6d4c3d] px-8 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#563a2d]"
            >
              Xem ngay
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
