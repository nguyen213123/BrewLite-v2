'use client';

import { useState } from 'react';
import { apiGet } from '@/lib/api';

export default function Home() {
  const [status, setStatus] = useState('Chưa kiểm tra kết nối');
  const [loading, setLoading] = useState(false);

  async function checkConnection() {
    setLoading(true);
    try {
      const result = await apiGet<{ status: string }>('/health/ready');
      setStatus(result.status === 'ok' ? 'Backend đang hoạt động' : 'Backend trả về trạng thái không hợp lệ');
    } catch {
      setStatus('Chưa kết nối được backend. Kiểm tra API và cấu hình môi trường.');
    } finally { setLoading(false); }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
      <p className="mb-8 text-sm font-bold uppercase tracking-[0.25em]">BrewLite / Khởi đầu</p>
      <h1 className="max-w-2xl text-5xl font-semibold leading-tight sm:text-7xl">Một khởi đầu mới cho BrewLite.</h1>
      <p className="mt-6 max-w-xl text-lg leading-8">Khung ứng dụng đã sẵn sàng để nhóm phát triển menu, giỏ hàng và luồng đặt đồ uống.</p>
      <section className="mt-10 rounded-2xl border border-[#cdd5c8] bg-white/60 p-6" aria-label="Kết nối API">
        <h2 className="text-lg font-semibold">Kết nối hệ thống</h2>
        <p className="mt-2 text-sm" role="status" aria-live="polite">{status}</p>
        <button onClick={checkConnection} disabled={loading} className="mt-5 rounded-lg bg-[#263c30] px-5 py-3 font-semibold text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4">
          {loading ? 'Đang kiểm tra…' : 'Kiểm tra backend'}
        </button>
      </section>
    </main>
  );
}
