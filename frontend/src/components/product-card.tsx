import Link from 'next/link';
import type { ProductSummary } from '@/lib/contracts/api.generated';
import { formatVnd } from '@/lib/format';
import { ProductImage } from './product-image';

export function ProductCard({ product }: { product: ProductSummary }) {
  const soldOut = product.stock <= 0;

  return (
    <article className="flex w-full flex-col overflow-hidden rounded-2xl border border-brew-line bg-white/60">
      <Link
        href={`/products/${product.id}`}
        className="group flex flex-1 flex-col focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brew-ink"
      >
        <ProductImage src={product.imageUrl} alt={product.name} className="aspect-[4/3] w-full" />
        <div className="flex flex-1 flex-col gap-1 p-4">
          <h2 className="text-lg font-semibold group-hover:underline">{product.name}</h2>
          <p className="line-clamp-2 text-sm text-brew-muted">{product.description}</p>
          <div className="mt-auto flex items-center justify-between pt-3">
            <p className="font-semibold">
              <span className="mr-1 text-xs font-normal text-brew-muted">Từ</span>
              {formatVnd(product.price)}
            </p>
            {soldOut && (
              <span className="rounded-full bg-brew-danger-bg px-3 py-1 text-xs font-semibold text-brew-danger">Hết hàng</span>
            )}
          </div>
        </div>
      </Link>
    </article>
  );
}
