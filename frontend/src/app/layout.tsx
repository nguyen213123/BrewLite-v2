import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import Header from '@/components/Header';

export const metadata: Metadata = {
  title: 'BrewLite',
  description: 'Đặt đồ uống trực tuyến, tùy chỉnh topping, thanh toán không tiền mặt và tích điểm thưởng.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body className="min-h-screen flex flex-col bg-[#faf6ec] text-[#4a2e20]">
        <Header />
        <div className="flex-1">{children}</div>

        {/* Footer 3 cột nền Nâu Cà Phê chuẩn theo mẫu thiết kế */}
        <footer className="bg-[#6d4c3d] text-[#faf6ec]">
          <div className="mx-auto max-w-6xl px-6 pt-12 pb-8">
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {/* Cột 1: Giới thiệu thương hiệu */}
              <div className="space-y-3">
                <h2 className="text-base font-bold text-white">BrewLite Mộc Vị</h2>
                <p className="max-w-xs text-xs leading-relaxed text-[#faf6ec]/80">
                  Trà sữa &amp; cà phê pha chế tươi mới mỗi ngày từ nguyên liệu tự nhiên. Đặt món trực tuyến, giữ hàng tự động và thanh toán không tiền mặt tiện lợi.
                </p>
              </div>

              {/* Cột 2: Thông tin liên hệ */}
              <div className="space-y-2.5">
                <h2 className="text-base font-bold text-white">Liên hệ với chúng tôi</h2>
                <ul className="space-y-2 text-xs text-[#faf6ec]/85">
                  <li className="flex items-center gap-2.5">
                    <span className="grid size-6 place-items-center rounded-full bg-white/15 text-[11px]">
                      📞
                    </span>
                    <span>(+84) 909 888 999</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="grid size-6 place-items-center rounded-full bg-white/15 text-[11px]">
                      ✉️
                    </span>
                    <span>cskh@brewlite-mocvi.vn</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="grid size-6 place-items-center rounded-full bg-white/15 text-[11px]">
                      🌐
                    </span>
                    <span>www.brewlite-mocvi.vn</span>
                  </li>
                </ul>
              </div>

              {/* Cột 3: Mạng xã hội & Liên kết nhanh */}
              <div className="space-y-3">
                <h2 className="text-base font-bold text-white">Kết nối &amp; Tiện ích</h2>
                <div className="flex items-center gap-2.5">
                  {[
                    { label: 'Facebook', icon: 'f' },
                    { label: 'Instagram', icon: 'ig' },
                    { label: 'YouTube', icon: '▶' },
                    { label: 'TikTok', icon: '♪' },
                  ].map((item) => (
                    <span
                      key={item.label}
                      title={item.label}
                      className="grid size-8 place-items-center rounded-full bg-white text-xs font-extrabold text-[#6d4c3d] shadow-xs"
                    >
                      {item.icon}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-2 text-xs text-[#faf6ec]/85">
                  <Link href="/menu" className="hover:text-white hover:underline">
                    Thực đơn
                  </Link>
                  <Link href="/cart" className="hover:text-white hover:underline">
                    Giỏ hàng
                  </Link>
                  <Link href="/orders" className="hover:text-white hover:underline">
                    Lịch sử đơn
                  </Link>
                  <Link href="/loyalty" className="hover:text-white hover:underline">
                    Điểm thưởng
                  </Link>
                </div>
              </div>
            </div>

            <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-white/20 pt-5 text-[11px] text-[#faf6ec]/75 sm:flex-row">
              <p>Copyright © 2026 BrewLite Mộc Vị. All rights reserved.</p>
              <p>www.brewlite-mocvi.vn</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
