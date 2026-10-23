'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiPost, ApiRequestError } from '@/lib/api';
import { setAuth } from '@/lib/auth';
import type { AuthResponse, LoginRequest } from '@/lib/contracts/api.generated';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Vui lòng nhập địa chỉ email.');
      return;
    }
    if (!password) {
      setError('Vui lòng nhập mật khẩu.');
      return;
    }

    setLoading(true);
    try {
      const payload: LoginRequest = { email: trimmedEmail, password };
      const response = await apiPost<AuthResponse>('/auth/login', payload);
      setAuth(response);
      router.push('/');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'INVALID_CREDENTIALS') {
          setError('Email hoặc mật khẩu không đúng. Vui lòng thử lại.');
        } else {
          setError(err.message || 'Đăng nhập thất bại.');
        }
      } else {
        setError('Không thể kết nối đến máy chủ. Vui lòng thử lại sau.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-[#cdd5c8] bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <Link href="/" className="text-xs font-bold uppercase tracking-[0.2em] text-[#263c30]/70 hover:text-[#263c30]">
            ← Về trang chủ BrewLite
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-[#263c30]">Đăng nhập</h1>
          <p className="mt-1 text-sm text-[#263c30]/70">Chào mừng bạn quay trở lại với BrewLite</p>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[#263c30]">
              Địa chỉ Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
              required
              disabled={loading}
              className="mt-1 block w-full rounded-lg border border-[#cdd5c8] px-3.5 py-2.5 text-sm outline-none transition focus:border-[#263c30] focus:ring-1 focus:ring-[#263c30] disabled:bg-gray-100"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-[#263c30]">
                Mật khẩu
              </label>
            </div>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={loading}
              className="mt-1 block w-full rounded-lg border border-[#cdd5c8] px-3.5 py-2.5 text-sm outline-none transition focus:border-[#263c30] focus:ring-1 focus:ring-[#263c30] disabled:bg-gray-100"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#263c30] py-3 text-sm font-semibold text-white shadow transition hover:bg-[#1f3026] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {loading ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-[#263c30]/70">
          Chưa có tài khoản?{' '}
          <Link href="/register" className="font-semibold text-[#263c30] underline hover:no-underline">
            Đăng ký ngay
          </Link>
        </div>
      </div>
    </div>
  );
}
