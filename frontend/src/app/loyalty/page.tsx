'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { apiGet, ApiRequestError } from '@/lib/api';
import { subscribeAuth, getAuthSnapshot, getAuthServerSnapshot, updateUserPoints } from '@/lib/auth';
import type { LoyaltyBalance, LoyaltyPage, LoyaltyEntry } from '@/lib/contracts/api.generated';
import { formatVnd } from '@/lib/format';

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
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="mx-auto max-w-lg rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-10 text-center shadow-xs">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#cbe8d3] text-3xl text-[#4a2e20]">
            ★
          </div>
          <p className="eyebrow mt-4">BrewLite Mộc Vị / Loyalty</p>
          <h1 className="mt-2 text-2xl font-extrabold text-[#4a2e20]">Cần đăng nhập</h1>
          <p className="mt-2 text-sm text-[#7a6254]">
            Vui lòng đăng nhập để xem số điểm thưởng và lịch sử tích lũy của bạn.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-full bg-[#6d4c3d] px-7 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#563a2d]"
          >
            Đăng nhập ngay
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div>
      {/* Banner Xanh Mint Pastel */}
      <section className="border-b border-[#b5dcc0] bg-[#cbe8d3]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">BrewLite Mộc Vị / Khách hàng thân thiết</p>
            <h1 className="mt-1.5 text-3xl font-extrabold tracking-tight text-[#4a2e20] sm:text-4xl">
              Điểm Thưởng Loyalty
            </h1>
            <p className="mt-1 text-sm text-[#5c4033]">
              Chương trình tri ân khách hàng thân thiết của BrewLite Mộc Vị
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="self-start rounded-full border-2 border-[#6d4c3d] bg-white px-5 py-2 text-xs font-bold text-[#4a2e20] transition hover:bg-[#6d4c3d] hover:text-white disabled:opacity-50 sm:self-auto"
          >
            {loading ? 'Đang tải…' : '↻ Làm mới'}
          </button>
        </div>
      </section>

      <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        {error && (
          <div
            role="alert"
            className="flex items-center justify-between rounded-2xl border border-[#e5b8b8] bg-[#fbeaea] p-4 text-sm text-[#9b2c2c]"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={handleRefresh}
              className="ml-4 font-bold underline hover:no-underline"
            >
              Thử lại
            </button>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-3.5 shadow-xs">
            <div className="flex items-center gap-5 rounded-xl bg-white p-6">
              <div className="grid size-14 shrink-0 place-items-center rounded-full bg-[#6d4c3d] text-2xl text-white">
                ★
              </div>
              <div>
                <span className="block text-xs font-bold uppercase tracking-wider text-[#7a6254]">
                  Điểm tích lũy hiện tại
                </span>
                <span className="text-3xl font-extrabold text-[#4a2e20]">
                  {balance ? balance.points.toLocaleString('vi-VN') : (user?.loyaltyPoints ?? 0)}
                </span>
                <span className="ml-1.5 text-sm font-bold text-[#6d4c3d]">điểm</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-3.5 shadow-xs">
            <div className="flex items-center gap-5 rounded-xl bg-white p-6">
              <div className="grid size-14 shrink-0 place-items-center rounded-full bg-[#cbe8d3] text-2xl text-[#4a2e20]">
                ☕
              </div>
              <div>
                <span className="block text-xs font-bold uppercase tracking-wider text-[#7a6254]">
                  Quy tắc cộng điểm
                </span>
                <p className="mt-0.5 text-base font-extrabold text-[#4a2e20]">
                  1 điểm cho mỗi {formatVnd(balance?.earnRateVnd ?? 10000)}
                </p>
                <p className="mt-0.5 text-xs text-[#7a6254]">
                  Tự động cộng khi đơn PAID và hoàn đảo nếu hủy trước pha chế
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Ledger History Table */}
        <div className="rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-4 shadow-xs">
          <div className="space-y-4 rounded-xl bg-white p-6 sm:p-8">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-[#4a2e20]">Lịch sử biến động điểm</h2>
              <span className="text-xs font-semibold text-[#7a6254]">
                Sổ cái giao dịch (Ledger)
              </span>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-[#faf6ec]" />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#decbb4] bg-[#faf6ec] p-10 text-center text-sm text-[#7a6254]">
                Chưa có giao dịch tích điểm nào được ghi nhận.
              </div>
            ) : (
              <div className="divide-y divide-[#decbb4]/70">
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
                    <div key={entry.id} className="flex items-center justify-between gap-4 py-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span
                            className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-bold ${
                              isEarn
                                ? 'border-[#9ecfb0] bg-[#cbe8d3] text-[#2d6a4f]'
                                : 'border-[#e5b8b8] bg-[#fbeaea] text-[#9b2c2c]'
                            }`}
                          >
                            {isEarn ? 'Tích điểm đơn hàng' : 'Đảo điểm (Hủy đơn)'}
                          </span>
                          <Link
                            href={`/orders/${entry.orderId}`}
                            className="font-mono text-xs font-bold text-[#6d4c3d] underline underline-offset-4 hover:text-[#4a2e20]"
                          >
                            Chi tiết đơn →
                          </Link>
                        </div>
                        <p className="text-xs text-[#7a6254]">{formattedDate}</p>
                      </div>

                      <div className="text-right">
                        <span
                          className={`text-base font-extrabold ${
                            isEarn ? 'text-[#2d6a4f]' : 'text-[#9b2c2c]'
                          }`}
                        >
                          {entry.points > 0 ? `+${entry.points}` : entry.points}
                        </span>
                        <span className="ml-1 text-xs font-medium text-[#7a6254]">điểm</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-[#decbb4]/70 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setPage((p) => Math.max(1, p - 1));
                  }}
                  disabled={page <= 1}
                  className="rounded-full border-2 border-[#6d4c3d] bg-white px-4 py-1.5 text-xs font-bold text-[#4a2e20] transition hover:bg-[#6d4c3d] hover:text-white disabled:opacity-40"
                >
                  ← Trang trước
                </button>
                <span className="text-xs font-bold text-[#7a6254]">
                  Trang {page} / {totalPages} (Tổng {total} bản ghi)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setPage((p) => Math.min(totalPages, p + 1));
                  }}
                  disabled={page >= totalPages}
                  className="rounded-full border-2 border-[#6d4c3d] bg-white px-4 py-1.5 text-xs font-bold text-[#4a2e20] transition hover:bg-[#6d4c3d] hover:text-white disabled:opacity-40"
                >
                  Trang sau →
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
