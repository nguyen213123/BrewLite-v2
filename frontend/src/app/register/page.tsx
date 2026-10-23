'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiPost, ApiRequestError } from '@/lib/api';
import { setAuth } from '@/lib/auth';
import type { AuthRequest, AuthResponse } from '@/lib/contracts/api.generated';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
    if (password.length < 8) {
      setError('Mật khẩu phải có tối thiểu 8 ký tự.');
      return;
    }
    if (new TextEncoder().encode(password).length > 72) {
      setError('Mật khẩu không được vượt quá 72 byte.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Xác nhận mật khẩu không khớp.');
      return;
    }

    setLoading(true);
    try {
      const payload: AuthRequest = { email: trimmedEmail, password };
      const response = await apiPost<AuthResponse>('/auth/register', payload);
      setAuth(response);
      router.push('/');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'EMAIL_ALREADY_EXISTS') {
          setError('Email này đã được sử dụng. Vui lòng đăng nhập hoặc dùng email khác.');
        } else if (err.code === 'VALIDATION_ERROR' && err.details && err.details.length > 0) {
          setError(err.details.map((d) => `${d.field}: ${d.message}`).join(', '));
        } else {
          setError(err.message || 'Đăng ký không thành công.');
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
          <h1 className="mt-3 text-2xl font-bold text-[#263c30]">Đăng ký tài khoản</h1>
          <p className="mt-1 text-sm text-[#263c30]/70">Tạo tài khoản để tích điểm và theo dõi đơn hàng</p>
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
            <label htmlFor="password" className="block text-sm font-medium text-[#263c30]">
              Mật khẩu (tối thiểu 8 ký tự)
            </label>
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

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-[#263c30]">
              Xác nhận mật khẩu
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
            {loading ? 'Đang tạo tài khoản…' : 'Đăng ký'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-[#263c30]/70">
          Đã có tài khoản?{' '}
          <Link href="/login" className="font-semibold text-[#263c30] underline hover:no-underline">
            Đăng nhập
          </Link>
        </div>
      </div>
    </div>
  );
}
