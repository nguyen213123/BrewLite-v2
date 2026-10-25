# Ghi nhận cải tiến sau nghiệm thu

Ngày 26/10/2026. Đây là đề xuất dựa trên đợt kiểm thử; chưa phải ý kiến được toàn nhóm biểu quyết.

Điều nên giữ: contract/fixture dùng chung; test DB cho transaction và cạnh tranh; dùng API thật cho UI; CI gồm cả backend/frontend; ghi rõ gateway mock và giới hạn MVP.

Điều cần cải thiện: issue chức năng đã merge nhưng checklist/bằng chứng còn trống; tài liệu baseline vẫn mô tả stub cũ; thiếu ghi nhận clone mới, demo và lịch sprint. Nên lưu bằng chứng ngay trong PR và cập nhật issue khi tích hợp xong.

Hành động tiếp theo:

- Điều phối nhờ một thành viên chạy README từ clone mới và ghi kết quả bằng tài khoản của họ.
- Mỗi TV bổ sung phần demo và review thực tế vào checklist bàn giao.
- Nhóm điền ngày sprint theo dữ liệu thật; không lấy ngày merge thay ngày họp.
- Sau khi CI và review PR bàn giao đạt, hoàn tất #16.
- Nếu mở rộng ngoài MVP: tách issue cho hết hạn PENDING, đồng bộ nhiều tab, gateway thật và kiểm thử tải trên môi trường triển khai.
