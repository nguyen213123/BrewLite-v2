// Owner: TV1. Chỉ để hiển thị; tổng tiền thật do backend tính (business-rules §2.8).
export const formatVnd = (amount: number) => `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;
