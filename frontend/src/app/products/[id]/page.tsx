import { Product } from '@/components/catalog/Catalog';
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Product key={id} id={id} />;
}
