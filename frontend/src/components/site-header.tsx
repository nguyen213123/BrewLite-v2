import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-brew-line bg-brew-bg">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-bold tracking-wide focus-visible:outline-2 focus-visible:outline-offset-4">
          BrewLite
        </Link>
        <nav aria-label="Điều hướng chính" className="flex items-center gap-5 text-sm font-semibold">
          <Link href="/" className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">Menu</Link>
        </nav>
      </div>
    </header>
  );
}
