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
    <main className="mx-auto flex min-h-[calc(100vh-160px)] max-w-6xl flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-3.5 shadow-sm">
        <div className="rounded-xl bg-white p-7 sm:p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full border-2 border-[#6d4c3d] bg-[#cbe8d3] text-2xl text-[#4a2e20] shadow-2xs">
              ☕
            </div>
            <p className="eyebrow">BrewLite Mộc Vị</p>
            <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-[#4a2e20]">
              Đăng nhập
            </h1>
            <p className="mt-1 text-sm text-[#7a6254]">
              Chào mừng bạn quay trở lại với BrewLite Mộc Vị
            </p>
          </div>

          {error && (
            <div
              className="mb-5 rounded-xl border border-[#e5b8b8] bg-[#fbeaea] p-3.5 text-sm font-medium text-[#9b2c2c]"
              role="alert"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="block text-sm font-bold text-[#4a2e20]">
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
                className="mt-1.5 block w-full rounded-xl border border-[#decbb4] bg-[#faf6ec] px-3.5 py-2.5 text-sm text-[#4a2e20] outline-none transition focus:border-[#6d4c3d] focus:bg-white focus:ring-2 focus:ring-[#6d4c3d]/15 disabled:opacity-60"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-bold text-[#4a2e20]">
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
                className="mt-1.5 block w-full rounded-xl border border-[#decbb4] bg-[#faf6ec] px-3.5 py-2.5 text-sm text-[#4a2e20] outline-none transition focus:border-[#6d4c3d] focus:bg-white focus:ring-2 focus:ring-[#6d4c3d]/15 disabled:opacity-60"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-[#6d4c3d] py-3 text-sm font-bold text-white shadow-xs transition hover:bg-[#563a2d] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {loading ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </button>
          </form>

          <div className="mt-6 border-t border-[#decbb4]/70 pt-5 text-center text-sm text-[#7a6254]">
            Chưa có tài khoản?{' '}
            <Link
              href="/register"
              className="font-bold text-[#6d4c3d] underline underline-offset-4 hover:text-[#4a2e20]"
            >
              Đăng ký ngay
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
