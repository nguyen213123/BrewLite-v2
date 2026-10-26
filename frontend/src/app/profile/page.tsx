'use client';

import { Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiGet, ApiRequestError } from '@/lib/api';
import {
  clearAuth,
  subscribeAuth,
  getAuthSnapshot,
  getAuthServerSnapshot,
  updateUserPoints,
} from '@/lib/auth';
import type {
  LoyaltyBalance,
  LoyaltyEntry,
  LoyaltyPage,
  OrderPage,
  OrderSummary,
} from '@/lib/contracts/api.generated';
import OrderStatusBadge from '@/components/OrderStatusBadge';
import { formatVnd } from '@/lib/format';

type ProfileTab = 'all' | 'orders' | 'loyalty';

function ProfileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: ProfileTab =
    tabParam === 'orders' || tabParam === 'loyalty' ? tabParam : 'all';

  const user = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthServerSnapshot);
  const [balance, setBalance] = useState<LoyaltyBalance | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotalPages, setOrderTotalPages] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);

  const [entries, setEntries] = useState<LoyaltyEntry[]>([]);
  const [entryPage, setEntryPage] = useState(1);
  const [entryTotalPages, setEntryTotalPages] = useState(1);
  const [entryTotal, setEntryTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let ignore = false;
    if (!user) return;

    async function loadProfileData() {
      try {
        const [balRes, ordersRes, entriesRes] = await Promise.all([
          apiGet<LoyaltyBalance>('/loyalty/me'),
          apiGet<OrderPage>(`/orders/me?page=${orderPage}&limit=8`),
          apiGet<LoyaltyPage>(`/loyalty/me/entries?page=${entryPage}&limit=8`),
        ]);
        if (!ignore) {
          setBalance(balRes);
          updateUserPoints(balRes.points);
          setOrders(ordersRes.data);
          setOrderPage(ordersRes.meta.page);
          setOrderTotalPages(ordersRes.meta.totalPages);
          setOrderTotal(ordersRes.meta.total);
          setEntries(entriesRes.data);
          setEntryPage(entriesRes.meta.page);
          setEntryTotalPages(entriesRes.meta.totalPages);
          setEntryTotal(entriesRes.meta.total);
          setError(null);
        }
      } catch (err) {
        if (!ignore) {
          if (err instanceof ApiRequestError) {
            setError(err.message || 'Không thể tải dữ liệu hồ sơ người dùng.');
          } else {
            setError('Lỗi kết nối tới máy chủ. Vui lòng thử lại sau.');
          }
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadProfileData();
    return () => {
      ignore = true;
    };
  }, [user, orderPage, entryPage, refreshToken]);

  function handleRefresh() {
    setLoading(true);
    setRefreshToken((t) => t + 1);
  }

  function handleLogout() {
    clearAuth();
    router.push('/login');
  }

  function setTab(next: ProfileTab) {
    router.replace(next === 'all' ? '/profile' : `/profile?tab=${next}`);
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <div className="mx-auto max-w-lg rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-10 text-center shadow-xs">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#cbe8d3] text-3xl text-[#4a2e20]">
            👤
          </div>
          <p className="eyebrow mt-4">BrewLite Mộc Vị / Tài khoản</p>
          <h1 className="mt-2 text-2xl font-extrabold text-[#4a2e20]">Cần đăng nhập</h1>
          <p className="mt-2 text-sm text-[#7a6254]">
            Vui lòng đăng nhập để xem hồ sơ cá nhân, lịch sử đơn hàng và điểm tích lũy của bạn.
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

  const displayName = user.email.split('@')[0] || user.email;
  const currentPoints = balance ? balance.points : user.loyaltyPoints;

  return (
    <div>
      {/* Banner Hồ sơ người dùng */}
      <section className="border-b border-[#b5dcc0] bg-[#cbe8d3]">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">BrewLite Mộc Vị / Hồ sơ cá nhân</p>
            <h1 className="mt-1.5 text-3xl font-extrabold tracking-tight text-[#4a2e20] sm:text-4xl">
              Xin chào, {displayName}
            </h1>
            <p className="mt-1 text-sm text-[#5c4033]">
              Quản lý thông tin tài khoản, theo dõi lịch sử đơn hàng và điểm thưởng tích lũy tại một nơi.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/menu"
              className="rounded-full bg-[#6d4c3d] px-5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-[#563a2d]"
            >
              + Đặt đơn mới
            </Link>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="rounded-full border-2 border-[#6d4c3d] bg-white px-4 py-1.5 text-xs font-bold text-[#4a2e20] transition hover:bg-[#6d4c3d] hover:text-white disabled:opacity-50"
            >
              {loading ? 'Đang tải…' : '↻ Làm mới'}
            </button>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
        {error && (
          <div
            role="alert"
            className="flex items-center justify-between rounded-2xl border border-[#e5b8b8] bg-[#fbeaea] p-4 text-sm text-[#9b2c2c]"
          >
            <span className="font-medium">{error}</span>
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-full border border-[#e5b8b8] bg-white px-4 py-1.5 text-xs font-bold text-[#9b2c2c] hover:bg-[#fbeaea]"
            >
              Thử lại
            </button>
          </div>
        )}

        {/* Thẻ Hồ sơ người dùng & Số điểm tích lũy hiện có */}
        <section className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col justify-between rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-6 shadow-xs">
            <div className="flex items-start gap-4">
              <div className="grid size-16 shrink-0 place-items-center rounded-2xl border-2 border-[#6d4c3d] bg-[#cbe8d3] text-2xl font-extrabold uppercase text-[#4a2e20] shadow-2xs">
                {displayName.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-extrabold text-[#4a2e20]">{displayName}</h2>
                  <span className="rounded-full bg-[#cbe8d3] px-2.5 py-0.5 text-xs font-bold text-[#2d6a4f]">
                    {user.role === 'STAFF' ? 'Nhân viên (STAFF)' : 'Khách hàng thân thiết'}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm font-medium text-[#7a6254]">
                  Email: <strong className="text-[#4a2e20]">{user.email}</strong>
                </p>
                <p className="mt-1 font-mono text-xs text-[#7a6254]">Mã TK: {user.id}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#decbb4] pt-4">
              <div className="text-xs text-[#7a6254]">
                Tổng đơn đã đặt: <strong className="text-[#4a2e20]">{orderTotal} đơn</strong>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full border border-[#e5b8b8] bg-white px-4 py-1.5 text-xs font-bold text-[#9b2c2c] transition hover:bg-[#fbeaea]"
              >
                Đăng xuất tài khoản
              </button>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl bg-[#6d4c3d] p-6 text-[#faf6ec] shadow-sm">
            <div className="pointer-events-none absolute -right-8 -bottom-8 size-36 rounded-full bg-[#cbe8d3]/15" />
            <p className="text-xs font-bold uppercase tracking-widest text-[#cbe8d3]">
              ★ Điểm tích lũy hiện có
            </p>
            <div className="mt-2 flex items-baseline gap-2.5">
              <span className="text-5xl font-extrabold tracking-tight text-white">
                {currentPoints}
              </span>
              <span className="text-lg font-bold text-[#cbe8d3]">điểm</span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-[#faf6ec]/85">
              Tỷ lệ tích điểm: Mỗi{' '}
              <strong className="text-[#cbe8d3]">
                {balance ? formatVnd(balance.earnRateVnd) : '10.000₫'}
              </strong>{' '}
              thanh toán = <strong className="text-[#cbe8d3]">+1 điểm</strong> (cộng khi đơn hàng{' '}
              <strong>COMPLETED</strong>).
            </p>
          </div>
        </section>

        {/* Thanh chuyển mục nhanh */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[#decbb4] pb-3">
          {[
            { id: 'all' as const, label: 'Tất cả (Đơn hàng & Điểm)' },
            { id: 'orders' as const, label: `📦 Lịch sử đơn hàng (${orderTotal})` },
            { id: 'loyalty' as const, label: `★ Lịch sử điểm thưởng (${entryTotal})` },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTab(tab.id)}
                className={`rounded-full px-4 py-2 text-xs font-bold transition ${
                  active
                    ? 'bg-[#6d4c3d] text-white shadow-2xs'
                    : 'border border-[#decbb4] bg-white text-[#4a2e20] hover:bg-[#efe5d4]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Khu vực Lịch sử đơn hàng */}
        {(activeTab === 'all' || activeTab === 'orders') && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-extrabold text-[#4a2e20]">📦 Lịch Sử Đơn Hàng</h2>
              <span className="rounded-full bg-[#efe5d4] px-3 py-1 text-xs font-bold text-[#6d4c3d]">
                Tổng: {orderTotal} đơn
              </span>
            </div>

            {orders.length === 0 ? (
              <div className="rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-8 text-center">
                <p className="text-sm font-bold text-[#4a2e20]">Bạn chưa có đơn hàng nào.</p>
                <Link
                  href="/menu"
                  className="mt-3 inline-block rounded-full bg-[#6d4c3d] px-5 py-2 text-xs font-bold text-white"
                >
                  Đặt món ngay →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {orders.map((order) => (
                  <article
                    key={order.id}
                    className="rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-4 shadow-xs transition hover:border-[#6d4c3d]"
                  >
                    <div className="flex flex-col justify-between gap-3 rounded-xl border border-[#decbb4]/80 bg-white p-4 sm:flex-row sm:items-center">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <Link
                            href={`/orders/${order.id}`}
                            className="font-mono text-base font-extrabold text-[#4a2e20] hover:text-[#6d4c3d] hover:underline"
                          >
                            {order.code}
                          </Link>
                          <OrderStatusBadge status={order.status} />
                          {order.status === 'COMPLETED' && (
                            <span className="rounded-full bg-[#cbe8d3] px-2.5 py-0.5 text-xs font-bold text-[#2d6a4f]">
                              +{Math.floor(order.total / 10000)} điểm
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#7a6254]">
                          Đặt lúc:{' '}
                          <span className="font-medium text-[#4a2e20]">
                            {new Date(order.createdAt).toLocaleString('vi-VN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                            })}
                          </span>
                          {' · '}Giữ kho:{' '}
                          <span className="font-semibold text-[#6d4c3d]">
                            {order.reservationStatus}
                          </span>
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-4 border-t border-[#decbb4] pt-3 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                        <span className="text-lg font-extrabold text-[#6d4c3d]">
                          {formatVnd(order.total)}
                        </span>
                        <div className="flex items-center gap-2">
                          {(order.status === 'PENDING' || order.status === 'PAYMENT_FAILED') && (
                            <Link
                              href={`/checkout?orderId=${order.id}`}
                              className="rounded-full bg-[#6d4c3d] px-3.5 py-1 text-xs font-bold text-white hover:bg-[#563a2d]"
                            >
                              Thanh toán
                            </Link>
                          )}
                          <Link
                            href={`/orders/${order.id}`}
                            className="text-xs font-bold text-[#4a2e20] hover:text-[#6d4c3d]"
                          >
                            Chi tiết đơn hàng →
                          </Link>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}

                {orderTotalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setOrderPage((p) => Math.max(1, p - 1))}
                      disabled={orderPage <= 1 || loading}
                      className="rounded-full border-2 border-[#6d4c3d] bg-white px-4 py-1.5 text-xs font-bold text-[#4a2e20] disabled:opacity-40"
                    >
                      ← Trang trước
                    </button>
                    <span className="text-xs font-bold text-[#4a2e20]">
                      Trang {orderPage} / {orderTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setOrderPage((p) => Math.min(orderTotalPages, p + 1))}
                      disabled={orderPage >= orderTotalPages || loading}
                      className="rounded-full border-2 border-[#6d4c3d] bg-white px-4 py-1.5 text-xs font-bold text-[#4a2e20] disabled:opacity-40"
                    >
                      Trang sau →
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Khu vực Lịch sử biến động điểm thưởng */}
        {(activeTab === 'all' || activeTab === 'loyalty') && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-extrabold text-[#4a2e20]">
                ★ Lịch Sử Biến Động Điểm Thưởng
              </h2>
              <span className="rounded-full bg-[#efe5d4] px-3 py-1 text-xs font-bold text-[#6d4c3d]">
                Tổng: {entryTotal} giao dịch
              </span>
            </div>

            {entries.length === 0 ? (
              <div className="rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-8 text-center">
                <p className="text-sm font-bold text-[#4a2e20]">
                  Chưa có giao dịch điểm thưởng nào.
                </p>
                <p className="mt-1 text-xs text-[#7a6254]">
                  Điểm sẽ được cộng tự động khi đơn hàng của bạn chuyển sang trạng thái Hoàn thành (COMPLETED).
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-[#decbb4] bg-white shadow-xs">
                <ul className="divide-y divide-[#decbb4]">
                  {entries.map((entry) => {
                    const isEarn = entry.kind === 'EARN';
                    return (
                      <li
                        key={entry.id}
                        className="flex flex-col justify-between gap-3 p-4 transition hover:bg-[#faf6ec] sm:flex-row sm:items-center"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold ${
                              isEarn
                                ? 'bg-[#cbe8d3] text-[#2d6a4f]'
                                : 'bg-[#fbeaea] text-[#9b2c2c]'
                            }`}
                          >
                            {isEarn ? '+★' : '−★'}
                          </span>
                          <div>
                            <span className="text-sm font-bold text-[#4a2e20]">
                              {isEarn
                                ? 'Cộng điểm từ đơn hoàn thành'
                                : 'Hoàn trả điểm do hủy đơn'}
                            </span>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[#7a6254]">
                              <Link
                                href={`/orders/${entry.orderId}`}
                                className="font-mono font-bold text-[#6d4c3d] hover:underline"
                              >
                                Xem đơn #{entry.orderId.slice(0, 8)} →
                              </Link>
                              <span>·</span>
                              <span>
                                {new Date(entry.createdAt).toLocaleString('vi-VN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                        <span
                          className={`text-lg font-extrabold ${
                            entry.points > 0
                              ? 'text-[#2d6a4f]'
                              : entry.points < 0
                                ? 'text-[#9b2c2c]'
                                : 'text-[#7a6254]'
                          }`}
                        >
                          {entry.points > 0 ? `+${entry.points}` : entry.points} điểm
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {entryTotalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-[#decbb4] bg-[#efe5d4]/60 px-5 py-3">
                    <button
                      type="button"
                      onClick={() => setEntryPage((p) => Math.max(1, p - 1))}
                      disabled={entryPage <= 1 || loading}
                      className="rounded-full border border-[#6d4c3d] bg-white px-4 py-1 text-xs font-bold text-[#4a2e20] disabled:opacity-40"
                    >
                      ← Trước
                    </button>
                    <span className="text-xs font-bold text-[#4a2e20]">
                      Trang {entryPage} / {entryTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEntryPage((p) => Math.min(entryTotalPages, p + 1))}
                      disabled={entryPage >= entryTotalPages || loading}
                      className="rounded-full border border-[#6d4c3d] bg-white px-4 py-1 text-xs font-bold text-[#4a2e20] disabled:opacity-40"
                    >
                      Sau →
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-5xl px-6 py-12 text-center text-sm text-[#7a6254]">
          Đang tải hồ sơ người dùng…
        </main>
      }
    >
      <ProfileContent />
    </Suspense>
  );
}
