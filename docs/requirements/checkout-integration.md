# Tích hợp luồng đặt hàng và thanh toán

Phạm vi: API PostgreSQL thật, gateway thanh toán mô phỏng WALLET/CARD. Giữ public API/DTO và schema hiện hành; không thêm migration.

## Nguồn tích hợp

- Catalog/seed/ảnh: kế thừa phần triển khai PR #26 tại fa7a70c.
- Cart Zustand: kế thừa PR #27 tại e0b20a9; loại bỏ fallback xóa theo key-only và thêm receipt chống trừ giỏ lặp.
- Promotion rules: kế thừa PR #30 tại d79fbf0; sửa validate qty sau gộp và giới hạn subtotal bằng cùng quy tắc quote/create.
- Payment/idempotency, auth, history, loyalty, inventory và state machine: main tại 7afbf1e.

Đây là code tích hợp trên nhánh riêng, không phải thao tác merge/approve các PR thành viên trên GitHub. Khi các nhánh đó có cập nhật mới cần đối chiếu lại thay vì ghi đè các bản sửa.

## Hành vi

1. Catalog public cung cấp menu và chi tiết, lựa chọn size/topping; cart persist giữ định danh riêng cho từng dòng.
2. Checkout yêu cầu đăng nhập. Quote chỉ gửi ID/size/topping/qty và mã; backend dùng catalog trong transaction để kiểm tra lựa chọn, tính giá và giảm giá.
3. Tạo đơn giữ stock và promotion cùng transaction idempotency, snapshot đơn và event. Lỗi bất kỳ rollback tất cả.
4. Browser lưu request tạo đơn, khóa và snapshot giỏ trước POST. Timeout/reload khôi phục cùng intent, không tạo key mới. Sau create kể cả replay phải GET trạng thái hiện tại.
5. Lần thanh toán cũng lưu key/method/outcome trước POST. Lỗi kỹ thuật không đổi payload/key. Không tạo lần thanh toán mới trước khi xác minh PAYMENT_FAILED.
6. Luôn GET đơn sau payment; GET lỗi không xác nhận thành công hoặc trừ giỏ. PAID và các trạng thái pha chế/hoàn thành mới được trừ giỏ, gắn receipt orderId cùng cập nhật cart trong một lần persist.
7. Dòng bị xóa rồi thêm lại có id khác; snapshot cũ không xóa dòng mới. Món thêm vào dòng đang giữ được trừ đúng lượng đã mua. Replay/reload không trừ lần hai.
8. FAIL trả stock/promo và giữ cart. Retry key mới dùng cùng order/snapshot giá, giữ lại tài nguyên nguyên tử. Hủy PENDING/FAILED/PAID qua dịch vụ hiện có; hủy PAID hoàn payment và đảo điểm. UI tải số dư từ `/loyalty/me` thay vì tự cộng theo snapshot.
9. Intent theo userId; logout/đổi token/unmount ngăn phản hồi cũ tác động giỏ. Mỗi session chỉ có một intent hoạt động; bắt đầu đơn mới sau khi đơn cũ kết thúc/hủy hoặc yêu cầu tạo đơn bị từ chối chắc chắn.
10. Chi tiết đơn có liên kết tiếp tục thanh toán/hủy. `/checkout?orderId=...` xác minh quyền qua API; nếu đã mất snapshot giỏ ban đầu thì giữ giỏ hiện tại, không suy đoán dòng đã mua bằng product key. Không thay thế một intent PENDING/FAILED đang mở bằng đơn khác từ lịch sử.

## Kiểm tra thủ công

- Đăng ký/đăng nhập → menu → Cappuccino M, Kem, qty 2 → cart → quote SAVE10 → 108.000đ → tạo đơn → SUCCESS → PAID, cart trừ 2, số dư tăng 10, lịch sử có đơn.
- Cùng cấu hình → FAIL → PAYMENT_FAILED, cart giữ nguyên; chọn SUCCESS và thử lại khóa mới → cùng mã đơn PAID.
- Reload sau khi tạo đơn hoặc sau thanh toán → khôi phục đúng đơn, GET xác minh; không tạo đơn/thanh toán hay trừ giỏ lần nữa.
- Hủy PENDING/FAILED/PAID → kiểm tra giỏ, stock/promo/điểm; hủy lặp không hoàn lần hai.
- Mã sai/hết hạn, size/topping sai, sản phẩm ngừng bán, giỏ rỗng, thiếu kho, token hết hạn phải báo lỗi.
- Ngắt mạng lúc POST/GET → giữ giỏ, xác minh lại, chỉ gửi lại cùng attempt khi chưa xác nhận FAIL.

## Kiểm thử tự động

Kết quả kiểm thử: 21 suite backend, **367/367 test đạt với PostgreSQL thật**, không bỏ qua; frontend cart/checkout **35/35 test đạt**. Lint, TypeScript, build hai ứng dụng và kiểm tra hợp đồng đạt. Database test/preview tách khỏi database phát triển.

Bổ sung hồi quy ngày 25/10/2026 cho PR #31: sau khi POST có thể đã commit nhưng phản hồi bị mất, lỗi 401/4xx của lần gửi lại không được xóa trạng thái chưa rõ kết quả. Đăng nhập lại vẫn giữ khóa, payload và snapshot, chặn tạo đơn mới cho đến khi khôi phục được đơn cũ. Yêu cầu đầu tiên bị từ chối chắc chắn vẫn có thể sửa và bắt đầu lại. Test render component kiểm tra form khôi phục đúng CARD/FAIL từ attempt đã lưu, không hiển thị WALLET/SUCCESS; các control chỉ mở cho lần thử mới sau khi xác minh PAYMENT_FAILED.

Đã thao tác trên browser production: đăng ký tài khoản thử, chọn Cappuccino M + Kem × 2, SAVE10 ra 108.000đ; FAIL giữ giỏ; reload rồi retry cùng mã đơn thành PAID, badge giỏ về 0 và điểm lên 10; reload không phát sinh lần trừ khác; mở lại qua chi tiết đơn rồi hủy PAID thành CANCELLED, điểm về 0. Không dùng tiền thật.

- `npm test`: toàn bộ backend và test frontend cart/checkout, kể cả lỗi mạng, replay trạng thái cũ, reload, logout và nhấn lặp.
- `npm run test:db`: database tạm độc lập; seed hai lần kiểm tra số bản ghi, real HTTP auth/catalog/quote/create/payment/cancel, kho/promo/ledger rollback và 10 create tranh stock cuối.
- CI hiện chạy `npm test` với PostgreSQL và RUN_DB_TESTS=1, vì vậy test frontend mới cũng chạy trong CI.

Giới hạn: thanh toán mô phỏng; session checkout thuộc tab và không phải cơ chế đồng bộ nhiều tab. Không tự hết hạn đơn PENDING. Chưa có kiểm thử hiệu năng <500ms hoặc UI barista (không thuộc MVP).
