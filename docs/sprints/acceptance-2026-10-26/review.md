# Review đợt nghiệm thu

Ngày ghi nhận: 26/10/2026; đây là tổng hợp Git/test, chưa phải biên bản họp nhóm.

Các mốc merge (Asia/Saigon), dùng để tra cứu đóng góp, không suy ra ngày bắt đầu/kết thúc sprint:

| Ngày | PR trên main |
| --- | --- |
| 22/10 | #17–19 baseline và bộ khung |
| 23/10 | #22 tạo đơn, #21 xác thực |
| 24/10 | #23 lịch sử, #24 điểm, #25 transaction/inventory, #29 state, #20 payment |
| 25/10 | #31 tích hợp, #33 stock, #26 catalog, #30 promotion, #34 idempotency, #28 Menu, #27 cart, #35 detail |
| 26/10 | #32 checkout; nghiệm thu baseline 0eed8fe |

Đã đạt: [ma trận](../../qa/final/README.md), build production và dữ liệu DB thật; demo lỗi/retry/đổi giá/hoàn điểm có ảnh. Gateway mock được công bố rõ. Chưa phát hiện lỗi chặn MVP trong các ca đã chạy.

Chưa đạt để đóng #16: clone mới bởi người khác; ngày sprint thực tế; review/demo từng người và review hồ sơ bàn giao. Người dùng xác nhận chưa có thông tin; xem [checklist](../../qa/final/human-signoff.md). Không ghi thành viên đã dự họp, approve hoặc demo khi chưa có bằng chứng.
