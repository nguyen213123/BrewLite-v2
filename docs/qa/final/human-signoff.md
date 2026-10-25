# Xác nhận bàn giao cần nhóm thực hiện

Ngày lập: 26/10/2026. Trạng thái: **chưa xác nhận**. Người dùng đã trả lời “chưa có”; không suy diễn kết quả test tự động thành xác nhận của thành viên.

## Chạy từ clone mới bởi người khác

- [ ] Một thành viên ngoài người điều phối clone repository vào thư mục mới và ghi commit đầy đủ.
- [ ] Ghi tên/GitHub, ngày giờ, OS, Node/npm, Docker và các port sử dụng.
- [ ] Chạy đúng README: `npm ci`, `npm run setup`, tạo env lần đầu, tự đặt JWT_SECRET ≥32 ký tự; không gửi secret vào PR.
- [ ] Chạy migrate/seed trên DB demo có thể đặt lại, dev và Docker Compose; kiểm tra health/ready, Menu và checkout.
- [ ] Chạy lint/build/test; `test:db` không skip DB suites. Ghi lệnh, tổng số test và kết quả.
- [ ] Demo SUCCESS/FAIL/retry/cancel/history/loyalty; đính kèm ảnh hoặc video đã bỏ token/mật khẩu.
- [ ] Thành viên xác nhận kết quả bằng tài khoản GitHub của chính mình trên PR/Issue #16.

Mẫu điền: `GitHub: …; commit: …; thời điểm: …; OS/Node/npm/Docker: …; lệnh và kết quả: …; link bằng chứng: …; lỗi còn lại: …`.

## Phân công và demo

Các tài khoản/PR dưới đây lấy từ lịch sử repository; **không có nghĩa mọi người đã demo hoặc review đủ**.

| Vai trò | GitHub | PR tham chiếu | Xác nhận phần demo |
| --- | --- | --- | --- |
| TV1 catalog/detail/promotion | nghii1236 | #26, #30, #35 | [ ] Chưa có |
| TV2 menu/cart/checkout | phannguyen1105 | #27, #28, #32 | [ ] Chưa có |
| TV3 order/state/inventory | Pobby105 | #22, #25, #29, #33 | [ ] Chưa có |
| TV4 auth/history/loyalty | tenki1612 | #21, #23, #24 | [ ] Chưa có |
| TV5 payment | phuc35147-web | #20 | [ ] Chưa có |
| Điều phối/baseline/integration | nguyen213123 | #17–19, #31, #34 | [ ] Nhóm xác nhận |

- [ ] Điền ngày bắt đầu/kết thúc thực tế từng sprint và link planning/review/retrospective có thành viên xác nhận.
- [ ] Mỗi người liên kết review do chính mình thực hiện; không coi commit hoặc tên trong bảng là review.
- [ ] Có một người khác review PR bàn giao; CI ở commit cuối đạt.
- [ ] Sau khi đủ bằng chứng, cập nhật checklist Issue #16 rồi mới đóng.
