'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { apiGet, ApiRequestError } from '@/lib/api';
import { subscribeAuth, getAuthSnapshot, getAuthServerSnapshot, updateUserPoints } from '@/lib/auth';
import type { LoyaltyBalance, LoyaltyPage, LoyaltyEntry } from '@/lib/contracts/api.generated';

export default function LoyaltyPage() {
  const user = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthServerSnapshot);
  const [balance, setBalance] = useState<LoyaltyBalance | null>(null);
  const [entries, setEntries] = useState<LoyaltyEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let ignore = false;
    if (!user) {
      return;
    }

    async function loadData() {
      try {
        const [balRes, entriesRes] = await Promise.all([
          apiGet<LoyaltyBalance>('/loyalty/me'),
          apiGet<LoyaltyPage>(`/loyalty/me/entries?page=${page}&limit=10`),
        ]);

        if (!ignore) {
          setBalance(balRes);
          updateUserPoints(balRes.points);
          setEntries(entriesRes.data);
          setPage(entriesRes.meta.page);
          setTotalPages(entriesRes.meta.totalPages);
          setTotal(entriesRes.meta.total);
          setError(null);
        }
      } catch (err) {
        if (!ignore) {
          if (err instanceof ApiRequestError) {
            setError(err.message || 'Không thể tải thông tin điểm thưởng.');
          } else {
            setError('Lỗi kết nối tới máy chủ. Vui lòng thử lại sau.');
          }
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadData();
    return () => {
      ignore = true;
    };
  }, [user, page, refreshToken]);

  function handleRefresh() {
    setLoading(true);
    setRefreshToken((t) => t + 1);
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
        <div className="rounded-full bg-[#263c30]/10 p-4 text-3xl">⭐</div>
        <h1 className="mt-4 text-2xl font-bold text-[#263c30]">Cần đăng nhập</h1>
        <p className="mt-2 text-sm text-[#263c30]/70">
          Vui lòng đăng nhập để xem số điểm thưởng và lịch sử tích lũy của bạn.
        </p>
        <Link
          href="/login"
          className="mt-6 rounded-lg bg-[#263c30] px-6 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-[#1f3026]"
        >
          Đăng nhập ngay
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#cdd5c8] pb-6">
        <div>
          <h1 className="text-3xl font-bold text-[#263c30]">Điểm thưởng Loyalty</h1>
          <p className="mt-1 text-sm text-[#263c30]/70">
            Chương trình tri ân khách hàng thân thiết của BrewLite
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="self-start sm:self-auto rounded-lg border border-[#cdd5c8] bg-white px-3.5 py-2 text-xs font-semibold text-[#263c30] shadow-sm transition hover:bg-[#263c30] hover:text-white disabled:opacity-50"
        >
          {loading ? 'Đang tải…' : '↻ Làm mới'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={handleRefresh} className="underline font-semibold hover:no-underline ml-4">
            Thử lại
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-[#cdd5c8] bg-white p-6 shadow-sm flex items-center gap-5">
          <div className="rounded-2xl bg-[#263c30] text-white p-4 text-2xl">⭐</div>
          <div>
            <span className="text-xs uppercase tracking-wider text-[#263c30]/60 block">Điểm tích lũy hiện tại</span>
            <span className="text-3xl font-bold text-[#263c30]">
              {balance ? balance.points.toLocaleString('vi-VN') : user?.loyaltyPoints ?? 0}
            </span>
            <span className="ml-1.5 text-sm font-medium text-[#263c30]/80">điểm</span>
          </div>
        </div>

        <div className="rounded-2xl border border-[#cdd5c8] bg-white p-6 shadow-sm flex items-center gap-5">
          <div className="rounded-2xl bg-[#263c30]/10 text-[#263c30] p-4 text-2xl">☕</div>
          <div>
            <span className="text-xs uppercase tracking-wider text-[#263c30]/60 block">Quy tắc cộng điểm</span>
            <p className="text-sm font-semibold text-[#263c30] mt-0.5">
              1 điểm cho mỗi {(balance?.earnRateVnd ?? 10000).toLocaleString('vi-VN')} đ
            </p>
            <p className="text-xs text-[#263c30]/60 mt-0.5">
              Tự động cộng sau khi thanh toán thành công
            </p>
          </div>
        </div>
      </div>

      {/* Ledger History Table */}
      <div className="rounded-2xl border border-[#cdd5c8] bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-lg font-bold text-[#263c30]">Lịch sử biến động điểm</h2>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse h-16 rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#cdd5c8] p-8 text-center text-sm text-[#263c30]/70">
            Chưa có giao dịch tích điểm nào được ghi nhận.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {entries.map((entry) => {
              const formattedDate = new Date(entry.createdAt).toLocaleString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              });

              const isEarn = entry.kind === 'EARN';

              return (
                <div key={entry.id} className="py-3.5 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${
                          isEarn
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-red-50 text-red-800 border border-red-200'
                        }`}
                      >
                        {isEarn ? 'Tích điểm đơn hàng' : 'Đảo điểm (Hủy đơn)'}
                      </span>
                      <Link
                        href={`/orders/${entry.orderId}`}
                        className="text-xs text-[#263c30]/70 hover:text-[#263c30] underline font-mono"
                      >
                        Chi tiết đơn
                      </Link>
                    </div>
                    <p className="text-xs text-[#263c30]/50">{formattedDate}</p>
                  </div>

                  <div className="text-right">
                    <span
                      className={`text-base font-bold ${
                        isEarn ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {entry.points > 0 ? `+${entry.points}` : entry.points}
                    </span>
                    <span className="text-xs text-[#263c30]/60 ml-1">điểm</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 pt-4">
            <button
              onClick={() => {
                setLoading(true);
                setPage((p) => Math.max(1, p - 1));
              }}
              disabled={page <= 1}
              className="rounded-lg border border-[#cdd5c8] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#263c30] transition hover:bg-[#263c30] hover:text-white disabled:opacity-40"
            >
              ← Trang trước
            </button>
            <span className="text-xs text-[#263c30]/70">
              Trang {page} / {totalPages} (Tổng {total} bản ghi)
            </span>
            <button
              onClick={() => {
                setLoading(true);
                setPage((p) => Math.min(totalPages, p + 1));
              }}
              disabled={page >= totalPages}
              className="rounded-lg border border-[#cdd5c8] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#263c30] transition hover:bg-[#263c30] hover:text-white disabled:opacity-40"
            >
              Trang sau →
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
