import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/Header';

export const metadata: Metadata = {
  title: 'BrewLite',
  description: 'Ứng dụng đặt đồ uống và thanh toán không tiền mặt.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body className="min-h-screen flex flex-col bg-[#f7f4ed] text-[#263c30]">
        <Header />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
