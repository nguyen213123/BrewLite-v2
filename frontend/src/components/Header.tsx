'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearAuth, subscribeAuth, getAuthSnapshot, getAuthServerSnapshot } from '@/lib/auth';
import { useCartStore, useCartHydrated, totalQty } from '@/lib/cart/cart-store';

export default function Header() {
  const router = useRouter();
  const user = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthServerSnapshot);
  const lines = useCartStore(s => s.lines);
  const hydrated = useCartHydrated();

  function handleLogout() {
    clearAuth();
    router.push('/login');
  }

  return (
    <header className="border-b border-[#cdd5c8] bg-white/70 backdrop-blur-sm sticky top-0 z-50">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-[#263c30]">BrewLite</span>
            <span className="rounded bg-[#263c30]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#263c30]">
              v2
            </span>
          </Link>
          {user && (
            <div className="flex items-center gap-4 text-sm font-medium">
              <Link
                href="/orders"
                className="text-[#263c30]/80 transition hover:text-[#263c30]"
              >
                Lịch sử đơn
              </Link>
              <Link
                href="/loyalty"
                className="text-[#263c30]/80 transition hover:text-[#263c30]"
              >
                Điểm thưởng
              </Link>
            </div>
          )}
        </div>

        <nav className="flex items-center gap-4">
          <Link href="/menu">Menu</Link>
          <Link href="/cart">Giỏ hàng ({hydrated ? totalQty(lines) : 0})</Link>
          {user ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-[#263c30]">{user.email}</span>
                {user.role === 'STAFF' && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800">
                    STAFF
                  </span>
                )}
                <Link
                  href="/loyalty"
                  className="rounded-full bg-[#263c30] px-2.5 py-0.5 font-semibold text-white transition hover:bg-[#1f3026]"
                >
                  {user.loyaltyPoints} điểm
                </Link>
              </div>
              <button
                onClick={handleLogout}
                className="rounded-lg border border-[#cdd5c8] px-3 py-1.5 text-xs font-semibold text-[#263c30] transition hover:bg-[#263c30] hover:text-white"
              >
                Đăng xuất
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="rounded-lg px-3.5 py-1.5 text-xs font-semibold text-[#263c30] transition hover:bg-black/5"
              >
                Đăng nhập
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-[#263c30] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1f3026]"
              >
                Đăng ký
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
