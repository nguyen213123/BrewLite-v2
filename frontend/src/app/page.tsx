import { MenuGrid } from '@/components/menu-grid';

export default function MenuPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold sm:text-4xl">Menu hôm nay</h1>
      <p className="mt-2 mb-8 max-w-xl text-brew-muted">Chọn đồ uống yêu thích, thanh toán không tiền mặt và nhận nhanh tại quầy.</p>
      <MenuGrid />
    </main>
  );
}
