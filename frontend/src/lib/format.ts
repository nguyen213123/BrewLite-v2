const vnd = new Intl.NumberFormat('vi-VN');

/** Tiền là số nguyên VND; chỉ dùng để hiển thị. */
export function formatVnd(amount: number): string {
  return `${vnd.format(amount)} ₫`;
}
