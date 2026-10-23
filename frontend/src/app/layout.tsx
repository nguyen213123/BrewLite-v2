import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

export const metadata: Metadata = {
  title: 'BrewLite',
  description: 'Ứng dụng đặt đồ uống và thanh toán không tiền mặt.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
