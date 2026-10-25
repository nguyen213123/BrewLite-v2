const vnd = new Intl.NumberFormat('vi-VN');

/** Định dạng số nguyên VND để hiển thị, ví dụ 45000 -> "45.000đ". Chỉ dùng để hiển thị. */
export function formatVnd(amount: number): string {
  return `${vnd.format(amount)}đ`;
}
