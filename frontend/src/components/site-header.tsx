'use client';

import Link from 'next/link';
import { totalQty, useCartHydrated, useCartStore } from '@/lib/cart/cart-store';

export function SiteHeader() {
  const hydrated = useCartHydrated();
  const badge = useCartStore((s) => totalQty(s.lines));

  return (
    <header className="border-b border-[#cdd5c8] bg-[#f7f4ed]">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4" aria-label="Điều hướng chính">
        <Link href="/" className="text-sm font-bold uppercase tracking-[0.25em] focus-visible:outline-2 focus-visible:outline-offset-4">
          BrewLite
        </Link>
        <div className="flex items-center gap-6 text-sm font-semibold">
          <Link href="/" className="focus-visible:outline-2 focus-visible:outline-offset-4">Menu</Link>
          <Link href="/cart" className="relative focus-visible:outline-2 focus-visible:outline-offset-4" aria-label={`Giỏ hàng, ${hydrated ? badge : 0} món`}>
            Giỏ hàng
            {hydrated && badge > 0 && (
              <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-[#263c30] px-2 py-0.5 text-xs font-semibold text-white" data-testid="cart-badge">
                {badge}
              </span>
            )}
          </Link>
        </div>
      </nav>
    </header>
  );
}
