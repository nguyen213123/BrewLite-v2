import Link from 'next/link';
import type { ProductSummary } from '@/lib/contracts/api.generated';
import { formatVnd } from '@/lib/format';
import { ProductImage } from './product-image';

export function ProductCard({ product }: { product: ProductSummary }) {
  const soldOut = product.stock <= 0;

  return (
    <article className="flex w-full flex-col overflow-hidden rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-3.5 shadow-xs transition duration-200 hover:-translate-y-1 hover:border-[#6d4c3d] hover:shadow-md">
      <Link
        href={`/products/${product.id}`}
        className="group flex flex-1 flex-col focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6d4c3d]"
      >
        <div className="relative overflow-hidden rounded-xl bg-white shadow-2xs">
          <ProductImage
            src={product.imageUrl}
            alt={product.name}
            className="aspect-square w-full transition duration-300 group-hover:scale-105"
          />
          <div className="absolute top-2.5 right-2.5">
            {soldOut ? (
              <span className="rounded-full border border-[#e5b8b8] bg-[#fbeaea] px-2.5 py-1 text-[11px] font-bold text-[#9b2c2c] shadow-xs">
                Hết hàng
              </span>
            ) : (
              <span className="rounded-full bg-[#6d4c3d]/90 px-2.5 py-0.5 text-[11px] font-bold text-white backdrop-blur-xs">
                {formatVnd(product.price)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-between px-2 pt-3.5 pb-1 text-center">
          <div>
            <h3 className="text-base font-extrabold text-[#4a2e20] transition group-hover:text-[#6d4c3d]">
              {product.name}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#7a6254]">
              {product.description}
            </p>
          </div>

          <div className="mt-3 flex w-full items-center justify-center gap-2 border-t border-[#decbb4]/80 pt-2.5">
            <span className="text-xs font-bold text-[#6d4c3d]">
              Từ {formatVnd(product.price)}
            </span>
            <span className="text-xs text-[#decbb4]">•</span>
            <span className="text-xs font-semibold text-[#4a2e20] group-hover:underline">
              {soldOut ? 'Chi tiết' : 'Đặt món →'}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
