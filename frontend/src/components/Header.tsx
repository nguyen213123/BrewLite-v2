'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiGet } from '@/lib/api';
import {
  clearAuth,
  subscribeAuth,
  getAuthSnapshot,
  getAuthServerSnapshot,
  updateUserPoints,
} from '@/lib/auth';
import { useCartStore, useCartHydrated, totalQty } from '@/lib/cart/cart-store';

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const user = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthServerSnapshot);
  const lines = useCartStore((s) => s.lines);
  const hydrated = useCartHydrated();
  const cartCount = hydrated ? totalQty(lines) : 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user?.id) return;
    let ignore = false;
    apiGet<{ points: number }>('/loyalty/me')
      .then((res) => {
        if (!ignore) updateUserPoints(res.points);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [user?.id, pathname]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);

  function handleLogout() {
    setMenuOpen(false);
    clearAuth();
    router.push('/login');
  }

  const isMenuActive = pathname === '/' || pathname === '/menu' || pathname?.startsWith('/products');
  const isCartActive = pathname === '/cart' || pathname?.startsWith('/checkout');
  const isProfileActive =
    pathname?.startsWith('/profile') ||
    pathname?.startsWith('/orders') ||
    pathname?.startsWith('/loyalty');

  const displayName = user?.email ? user.email.split('@')[0] || user.email : '';

  const navItemClass = (active?: boolean) =>
    `relative py-1.5 text-sm font-semibold transition ${
      active
        ? 'text-[#4a2e20] after:absolute after:inset-x-0 after:bottom-0 after:h-[2.5px] after:rounded-full after:bg-[#6d4c3d]'
        : 'text-[#7a6254] hover:text-[#4a2e20]'
    }`;

  return (
    <header className="sticky top-0 z-50 shadow-xs">
      {/* Thanh tiện ích nâu phía trên cùng (Top Utility Bar) */}
      <div className="bg-[#6d4c3d] text-[#faf6ec]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-1.5 text-[11px]">
          <div className="flex flex-wrap items-center gap-4 opacity-90">
            <span>☕ BrewLite — Trà Sữa &amp; Cà Phê Mộc Vị</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">
              Đặt món trực tuyến &amp; Thanh toán không tiền mặt
            </span>
          </div>

          <div className="flex items-center gap-3">
            {user && (
              <Link
                href="/profile"
                className="flex items-center gap-2 no-underline transition hover:opacity-90"
              >
                <span className="max-w-[140px] truncate font-medium text-[#cbe8d3]">
                  {user.email}
                </span>
                {user.role === 'STAFF' && (
                  <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-[#4a2e20]">
                    STAFF
                  </span>
                )}
                <span className="rounded-full bg-[#cbe8d3] px-2 py-0.5 text-[10px] font-bold text-[#2d6a4f]">
                  ★ {user.loyaltyPoints} điểm
                </span>
              </Link>
            )}

            <div className="hidden items-center gap-1.5 sm:flex" aria-label="Mạng xã hội">
              {['f', 'ig', 'yt', 'in'].map((icon) => (
                <span
                  key={icon}
                  aria-hidden="true"
                  className="grid size-4.5 place-items-center rounded-full bg-white/15 text-[9px] font-bold text-white"
                >
                  {icon}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Thanh điều hướng chính nền kem ấm (Main Header) */}
      <div className="border-b border-[#decbb4] bg-[#faf6ec]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          {/* Logo tròn phong cách Mộc Vị */}
          <Link href="/" className="group flex items-center gap-3">
            <span
              className="grid size-11 place-items-center rounded-full border-2 border-[#6d4c3d] bg-[#cbe8d3] text-[#4a2e20] shadow-xs transition group-hover:scale-105"
              aria-hidden="true"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
                <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
                <path d="M6 2v3M10 2v3M14 2v3" />
              </svg>
            </span>
            <div className="leading-tight">
              <span className="block text-lg font-extrabold tracking-tight text-[#4a2e20]">
                BrewLite
              </span>
              <span className="block text-xs font-bold text-[#6d4c3d]">
                Mộc Vị <span className="text-[10px] font-normal opacity-75">v2</span>
              </span>
            </div>
          </Link>

          {/* Menu điều hướng chính ở giữa */}
          <nav className="hidden items-center gap-7 md:flex" aria-label="Điều hướng chính">
            <Link href="/menu" className={navItemClass(isMenuActive)}>
              Thực Đơn
            </Link>
          </nav>

          {/* Cụm nút hành động bên phải */}
          <div className="flex items-center gap-2.5">
            <Link
              href="/cart"
              className={`inline-flex items-center gap-2 rounded-full border-2 px-4 py-1.5 text-xs font-bold transition ${
                isCartActive
                  ? 'border-[#6d4c3d] bg-[#6d4c3d] text-white'
                  : 'border-[#6d4c3d] bg-transparent text-[#4a2e20] hover:bg-[#6d4c3d] hover:text-white'
              }`}
            >
              <span>Giỏ hàng</span>
              <span
                className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-extrabold ${
                  isCartActive ? 'bg-white text-[#6d4c3d]' : 'bg-[#6d4c3d] text-white'
                }`}
              >
                {cartCount}
              </span>
            </Link>

            {user ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  aria-expanded={menuOpen}
                  className={`inline-flex items-center gap-2 rounded-full border-2 px-3.5 py-1.5 text-xs font-bold transition ${
                    isProfileActive || menuOpen
                      ? 'border-[#6d4c3d] bg-[#6d4c3d] text-white'
                      : 'border-[#decbb4] bg-[#efe5d4] text-[#4a2e20] hover:border-[#6d4c3d]'
                  }`}
                  style={{ margin: 0 }}
                >
                  <span className="grid size-5 place-items-center rounded-full bg-[#cbe8d3] text-[10px] font-extrabold uppercase text-[#2d6a4f]">
                    {displayName.slice(0, 1) || 'U'}
                  </span>
                  <span className="max-w-[110px] truncate">{displayName}</span>
                  <span className="rounded-full bg-[#cbe8d3] px-2 py-0.5 text-[10px] font-extrabold text-[#2d6a4f]">
                    ★ {user.loyaltyPoints}
                  </span>
                  <span aria-hidden="true" className="text-[10px] opacity-80">
                    ▾
                  </span>
                </button>

                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-68 overflow-hidden rounded-2xl border border-[#decbb4] bg-white shadow-lg">
                    <div className="border-b border-[#decbb4] bg-[#efe5d4] p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-extrabold text-[#4a2e20]">
                          {displayName}
                        </span>
                        <span className="rounded-full bg-[#cbe8d3] px-2.5 py-0.5 text-xs font-bold text-[#2d6a4f]">
                          ★ {user.loyaltyPoints} điểm
                        </span>
                      </div>
                      <p className="m-0 mt-1 truncate text-xs text-[#7a6254]">{user.email}</p>
                    </div>

                    <div className="p-2 text-xs font-bold text-[#4a2e20]">
                      <Link
                        href="/profile"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center justify-between rounded-xl px-3 py-2.5 no-underline transition hover:bg-[#efe5d4]"
                      >
                        <span>👤 Hồ sơ người dùng</span>
                        <span className="text-[#7a6254]">→</span>
                      </Link>
                      <Link
                        href="/profile?tab=orders"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center justify-between rounded-xl px-3 py-2.5 no-underline transition hover:bg-[#efe5d4]"
                      >
                        <span>📦 Lịch sử đơn hàng</span>
                        <span className="text-[#7a6254]">→</span>
                      </Link>
                      <Link
                        href="/profile?tab=loyalty"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center justify-between rounded-xl px-3 py-2.5 no-underline transition hover:bg-[#efe5d4]"
                      >
                        <span>★ Điểm thưởng tích lũy</span>
                        <span className="rounded-full bg-[#cbe8d3] px-2 py-0.5 text-[10px] font-bold text-[#2d6a4f]">
                          {user.loyaltyPoints} điểm
                        </span>
                      </Link>
                    </div>

                    <div className="border-t border-[#decbb4] p-2">
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="w-full rounded-xl bg-[#fbeaea] px-3 py-2 text-left text-xs font-bold text-[#9b2c2c] transition hover:bg-[#f5d5d5]"
                        style={{ margin: 0, border: 'none' }}
                      >
                        Đăng xuất tài khoản
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  href="/login"
                  className="rounded-full px-3.5 py-1.5 text-xs font-bold text-[#4a2e20] transition hover:bg-[#efe5d4]"
                >
                  Đăng nhập
                </Link>
                <Link
                  href="/register"
                  className="rounded-full bg-[#6d4c3d] px-4 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#563a2d]"
                >
                  Đăng ký
                </Link>
              </div>
            )}
          </div>

          {/* Điều hướng di động */}
          <nav
            className="flex w-full items-center justify-around border-t border-[#decbb4]/70 pt-2.5 md:hidden"
            aria-label="Điều hướng di động"
          >
            <Link href="/menu" className={navItemClass(isMenuActive)}>
              Thực Đơn
            </Link>
            <Link href="/cart" className={navItemClass(isCartActive)}>
              Giỏ Hàng ({cartCount})
            </Link>
            {user && (
              <Link href="/profile" className={navItemClass(isProfileActive)}>
                Hồ Sơ ({displayName})
              </Link>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
