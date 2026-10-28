import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  LoyaltyTransactionsPort,
  OrderTransactionsPort,
  PaymentsPort,
} from '../../common/contracts/ports';
import { EmptyQueryDto } from '../../common/dto/shared.dto';
import { ApiError } from '../../common/errors/api-error';
import { CurrentUser, IdempotencyKey, JwtAuthGuard } from '../../common/security/security';
import type { CurrentUserData } from '../../common/security/security';
import { PrismaService } from '../../prisma/prisma.service';
import { isUniqueConstraintError } from '../idempotency/idempotency.service';
import {
  CreatePaymentDto,
  CreateVnPayUrlDto,
  VnPayActionDto,
  VnPayQueryDto,
} from './dto/payment.dto';
import { VnPayService, type VnPayVerifyResult } from './vnpay.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsPort,
    private readonly vnpay: VnPayService,
    private readonly prisma: PrismaService,
    private readonly orderTransactions: OrderTransactionsPort,
    private readonly loyaltyTransactions: LoyaltyTransactionsPort,
  ) {}

  @Post()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async pay(
    @CurrentUser() user: CurrentUserData,
    @IdempotencyKey() key: string,
    @Body() input: CreatePaymentDto,
    @Query() _query: EmptyQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.payments.pay(user.id, key, input);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return result.data;
  }

  /**
   * Tạo URL thanh toán VNPay Sandbox và lưu phiên thanh toán (txnRef, tmnCode, amount) để đối chiếu callback
   */
  @Post('vnpay/create-url')
  @UseGuards(JwtAuthGuard)
  async createVnPayUrl(
    @CurrentUser() user: CurrentUserData,
    @Body() body: CreateVnPayUrlDto,
    @Req() req: Request,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: body.orderId, userId: user.id },
      include: { items: { include: { toppings: true } } },
    });
    if (!order) {
      throw new ApiError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng');
    }
    if (order.status !== 'PENDING' && order.status !== 'PAYMENT_FAILED') {
      throw new ApiError(409, 'ORDER_NOT_PAYABLE', 'Đơn hàng không ở trạng thái có thể thanh toán');
    }

    const ipAddr =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    const session = this.vnpay.createPaymentSession({
      orderId: order.id,
      orderCode: order.code,
      amount: order.total,
      ipAddr,
    });

    const requestHash = this.computeAttemptHash({
      orderId: order.id,
      orderCode: order.code,
      txnRef: session.txnRef,
      tmnCode: session.tmnCode,
      amount: order.total,
    });

    await this.prisma.$transaction(async (tx) => {
      if (order.status === 'PAYMENT_FAILED') {
        await this.orderTransactions.prepareRetry(tx, order);
      }

      // Tuân thủ ràng buộc CHECK IdempotencyRecord_completion trên PostgreSQL:
      // status = 'PROCESSING' yêu cầu httpStatus IS NULL và response IS NULL
      await tx.idempotencyRecord.create({
        data: {
          userId: order.userId,
          scope: 'PAY_ORDER',
          key: session.txnRef,
          requestHash,
          status: 'PROCESSING',
        },
      });
    });

    return {
      paymentUrl: session.paymentUrl,
      txnRef: session.txnRef,
      orderCode: order.code,
      orderId: order.id,
      amount: order.total,
    };
  }

  /**
   * Xác thực kết quả VNPay Return URL khi trình duyệt redirect về website
   */
  @Get('vnpay/verify')
  async verifyVnPayReturn(
    @Query(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false }))
    query: VnPayQueryDto,
  ) {
    const rawParams = query as unknown as Record<string, string>;
    const result = this.vnpay.verifyResponse(rawParams);

    if (!result.isValid) {
      return {
        success: false,
        message: 'Chữ ký số hoặc mã merchant (vnp_TmnCode) không hợp lệ',
        orderCode: result.orderCode,
        responseCode: result.responseCode,
      };
    }

    const matched = await this.findSavedVnPayAttempt(result);
    if (!matched) {
      return {
        success: false,
        message: 'Không tìm thấy phiên thanh toán đã khởi tạo khớp với vnp_TxnRef',
        orderCode: result.orderCode,
        responseCode: result.responseCode,
      };
    }

    const { order, attemptRecord, savedMeta } = matched;

    if (
      order.total !== result.amount ||
      (typeof savedMeta.expectedAmount === 'number' && savedMeta.expectedAmount !== result.amount)
    ) {
      return {
        success: false,
        message: 'Số tiền thanh toán không khớp với đơn hàng',
        orderCode: order.code,
        orderId: order.id,
        orderStatus: order.status,
        amount: order.total,
        responseCode: result.responseCode,
      };
    }

    await this.settleVnPayCallback(order.id, attemptRecord.id, savedMeta, result);

    const latestOrder = await this.prisma.order.findUnique({
      where: { id: order.id },
    });
    const currentStatus = latestOrder?.status ?? order.status;

    if (currentStatus === 'CANCELLED') {
      return {
        success: false,
        message: 'Đơn hàng này đã bị hủy hoặc đã hoàn tiền',
        orderCode: order.code,
        orderId: order.id,
        orderStatus: currentStatus,
        amount: order.total,
        bankCode: result.bankCode,
        transactionNo: result.transactionNo,
        responseCode: result.responseCode,
      };
    }

    const isPaidOrder = ['PAID', 'PREPARING', 'READY', 'COMPLETED'].includes(currentStatus);
    if (result.isSuccess && isPaidOrder) {
      return {
        success: true,
        message: 'Thanh toán VNPay thành công',
        orderCode: order.code,
        orderId: order.id,
        orderStatus: currentStatus,
        amount: order.total,
        bankCode: result.bankCode,
        transactionNo: result.transactionNo,
        responseCode: result.responseCode,
      };
    }

    return {
      success: false,
      message: result.message,
      orderCode: order.code,
      orderId: order.id,
      orderStatus: currentStatus,
      amount: order.total,
      responseCode: result.responseCode,
    };
  }

  /**
   * Endpoint IPN (Instant Payment Notification) Server-to-Server theo chuẩn VNPay.
   * Xác thực bằng chữ ký số VNPay (không dùng JWT của người dùng).
   */
  @Get('vnpay/ipn')
  async handleVnPayIpn(
    @Query(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false }))
    query: VnPayQueryDto,
  ) {
    const rawParams = query as unknown as Record<string, string>;
    const result = this.vnpay.verifyResponse(rawParams);

    if (!result.isValid) {
      return { RspCode: '97', Message: 'Checksum failed' };
    }

    const matched = await this.findSavedVnPayAttempt(result);
    if (!matched) {
      return { RspCode: '01', Message: 'Order not found' };
    }

    const { order, attemptRecord, savedMeta } = matched;

    if (
      order.total !== result.amount ||
      (typeof savedMeta.expectedAmount === 'number' && savedMeta.expectedAmount !== result.amount)
    ) {
      return { RspCode: '04', Message: 'Invalid amount' };
    }

    if (
      attemptRecord.status === 'COMPLETED' ||
      (order.status !== 'PENDING' && order.status !== 'PAYMENT_FAILED')
    ) {
      return { RspCode: '02', Message: 'Order already confirmed' };
    }

    const settlement = await this.settleVnPayCallback(
      order.id,
      attemptRecord.id,
      savedMeta,
      result,
    );

    if (settlement.alreadyConfirmed) {
      return { RspCode: '02', Message: 'Order already confirmed' };
    }

    return { RspCode: '00', Message: 'Confirm Success' };
  }

  /**
   * Tra cứu danh sách lịch sử giao dịch VNPay Sandbox đã ghi nhận.
   * Yêu cầu đăng nhập: CUSTOMER chỉ xem được giao dịch thuộc đơn của mình; STAFF xem được toàn bộ.
   */
  @Get('vnpay/transactions')
  @UseGuards(JwtAuthGuard)
  async listVnPayTransactions(@CurrentUser() user: CurrentUserData) {
    const payments = await this.prisma.payment.findMany({
      where:
        user.role === 'STAFF'
          ? { method: 'CARD' }
          : { method: 'CARD', order: { userId: user.id } },
      include: {
        order: true,
        idempotency: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const items = payments.map((p) => {
      const meta = (p.idempotency?.response ?? {}) as Record<string, unknown>;
      const transactionNo =
        typeof meta.transactionNo === 'string' && meta.transactionNo.length > 0
          ? meta.transactionNo
          : p.id.slice(0, 8);
      const txnRef =
        typeof meta.txnRef === 'string' && meta.txnRef.length > 0
          ? meta.txnRef
          : p.idempotencyKey;
      const bankCode =
        typeof meta.bankCode === 'string' && meta.bankCode.length > 0
          ? meta.bankCode
          : 'NCB';
      const bankTranNo =
        typeof meta.bankTranNo === 'string' && meta.bankTranNo.length > 0
          ? meta.bankTranNo
          : `VNP${transactionNo}`;
      const cardType =
        typeof meta.cardType === 'string' && meta.cardType.length > 0
          ? meta.cardType
          : 'ATM';
      const payDate =
        typeof meta.payDate === 'string' && meta.payDate.length > 0
          ? meta.payDate
          : this.toVnPayDateString(p.createdAt);
      const refundStatus =
        typeof meta.refundStatus === 'string' ? meta.refundStatus : undefined;

      return {
        paymentId: p.id,
        orderId: p.orderId,
        orderCode: p.order.code,
        orderStatus: p.order.status,
        paymentStatus: p.status,
        refundStatus,
        amount: p.amount,
        transactionNo,
        txnRef,
        bankCode,
        bankTranNo,
        cardType,
        payDate,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    });

    return { items };
  }

  /**
   * Đối soát trực tiếp trạng thái giao dịch với cổng VNPay Sandbox (QueryDR).
   * Yêu cầu đăng nhập và kiểm tra quyền sở hữu đơn hàng (hoặc STAFF).
   */
  @Post('vnpay/querydr')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async queryVnPayTransaction(
    @CurrentUser() user: CurrentUserData,
    @Body(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false }))
    body: VnPayActionDto,
    @Req() req: Request,
  ) {
    const target = await this.findTargetVnPayPayment(body, user);
    if (!target) {
      throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Không tìm thấy giao dịch VNPay tương ứng');
    }

    const ipAddr =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    const gatewayResult = await this.vnpay.queryTransaction({
      txnRef: target.txnRef,
      transactionDate: target.payDate,
      orderCode: target.order.code,
      expectedAmount: target.payment.amount,
      ipAddr,
    });

    let currentOrderStatus = target.order.status;
    let currentPaymentStatus = target.payment.status;
    let currentRefundStatus =
      typeof target.meta.refundStatus === 'string' ? target.meta.refundStatus : undefined;
    let message = 'Đối soát thành công: Cổng VNPay xác nhận giao dịch hợp lệ (vnp_ResponseCode = 00)';

    // Nếu giao dịch đang ở trạng thái chờ đối soát hoàn tiền (PENDING_RECONCILIATION),
    // cập nhật trạng thái theo kết quả đối soát đã xác minh chữ ký từ cổng VNPay:
    if (target.meta.refundStatus === 'PENDING_RECONCILIATION') {
      const isRefundConfirmedByGateway =
        gatewayResult.vnp_TransactionType === '02' &&
        gatewayResult.vnp_TransactionStatus === '00';
      const isRefundStillProcessing =
        gatewayResult.vnp_TransactionStatus === '01' ||
        gatewayResult.vnp_TransactionStatus === '94';

      if (isRefundConfirmedByGateway) {
        await this.prisma.$transaction(async (tx) => {
          const currentOrder = await tx.order.findUnique({
            where: { id: target.order.id },
            include: { items: { include: { toppings: true } } },
          });

          if (currentOrder && currentOrder.status === 'PAID') {
            await this.orderTransactions.transition(tx, {
              orderId: currentOrder.id,
              actorUserId: user.id,
              expectedVersion: currentOrder.version,
              toStatus: 'CANCELLED',
            });
            await this.loyaltyTransactions.reverse(tx, currentOrder);
          }

          await tx.payment.update({
            where: { id: target.payment.id },
            data: { status: 'REFUNDED' },
          });

          await tx.idempotencyRecord.update({
            where: { id: target.payment.idempotencyRecordId },
            data: {
              status: 'COMPLETED',
              httpStatus: 200,
              response: {
                ...target.meta,
                refundStatus: 'REFUNDED',
                refundTransactionNo: gatewayResult.vnp_TransactionNo,
                refundResponseCode: gatewayResult.vnp_ResponseCode,
              },
            },
          });
        });

        currentOrderStatus = 'CANCELLED';
        currentPaymentStatus = 'REFUNDED';
        currentRefundStatus = 'REFUNDED';
        message =
          'Đối soát thành công: Cổng VNPay xác nhận yêu cầu hoàn tiền trước đó đã hoàn tất, đã đồng bộ hủy đơn và hoàn kho';
      } else if (!isRefundStillProcessing) {
        // Cổng VNPay xác nhận giao dịch chưa hoàn tiền và không còn lệnh hoàn tiền đang xử lý -> mở khóa để cho phép thao tác tiếp
        await this.prisma.idempotencyRecord.update({
          where: { id: target.payment.idempotencyRecordId },
          data: {
            status: 'COMPLETED',
            httpStatus: 200,
            response: {
              ...target.meta,
              refundStatus: 'RECONCILED_NOT_REFUNDED',
              lastQueryTransactionType: gatewayResult.vnp_TransactionType,
              lastQueryTransactionStatus: gatewayResult.vnp_TransactionStatus,
            },
          },
        });
        currentRefundStatus = 'RECONCILED_NOT_REFUNDED';
        message =
          'Đối soát thành công: Cổng VNPay xác nhận giao dịch chưa hoàn tiền, đã mở khóa để cho phép thao tác tiếp';
      } else {
        message =
          'Đối soát thành công: Yêu cầu hoàn tiền vẫn đang được cổng VNPay xử lý, tiếp tục giữ trạng thái chờ đối soát';
      }
    }

    return {
      success: true,
      message,
      transaction: {
        paymentId: target.payment.id,
        orderId: target.order.id,
        orderCode: target.order.code,
        orderStatus: currentOrderStatus,
        paymentStatus: currentPaymentStatus,
        refundStatus: currentRefundStatus,
        amount: target.payment.amount,
        transactionNo: target.transactionNo,
        txnRef: target.txnRef,
        bankCode: target.bankCode,
        bankTranNo: target.bankTranNo,
        cardType: target.cardType,
        payDate: target.payDate,
      },
      gateway: gatewayResult,
    };
  }

  /**
   * Thực hiện hoàn tiền giao dịch qua VNPay Sandbox (Refund API) và hủy đơn / giải phóng tồn kho / đảo điểm thưởng.
   * Chỉ cập nhật REFUNDED khi nhận phản hồi xác nhận hợp lệ (00) từ VNPay.
   */
  @Post('vnpay/refund')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async refundVnPayTransaction(
    @CurrentUser() user: CurrentUserData,
    @Body(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false }))
    body: VnPayActionDto,
    @Req() req: Request,
  ) {
    const target = await this.findTargetVnPayPayment(body, user);
    if (!target) {
      throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Không tìm thấy giao dịch VNPay để hoàn tiền');
    }

    if (target.meta.refundStatus === 'PENDING_RECONCILIATION') {
      throw new ApiError(
        409,
        'REFUND_PENDING_RECONCILIATION',
        'Yêu cầu hoàn tiền trước đó chưa rõ kết quả từ VNPay và đang chờ đối soát. Không gửi hoàn tiền lặp.',
      );
    }

    if (target.payment.status === 'REFUNDED') {
      throw new ApiError(409, 'PAYMENT_ALREADY_REFUNDED', 'Giao dịch này đã được hoàn tiền trước đó');
    }

    if (target.payment.status !== 'SUCCEEDED') {
      throw new ApiError(
        409,
        'PAYMENT_NOT_REFUNDABLE',
        'Chỉ có thể hoàn tiền cho giao dịch đã thanh toán thành công',
      );
    }

    if (target.order.status !== 'PAID') {
      throw new ApiError(
        409,
        'ORDER_NOT_REFUNDABLE',
        `Chỉ có thể hoàn tiền và hủy đơn khi đơn hàng ở trạng thái PAID (hiện tại: ${target.order.status})`,
      );
    }

    // Khóa nguyên tử (atomic lock) trên IdempotencyRecord (httpStatus 200 -> 201) để chặn các yêu cầu hoàn tiền đồng thời
    // đồng thời tuân thủ ràng buộc CHECK IdempotencyRecord_completion (status = 'COMPLETED' AND httpStatus IN (200, 201))
    const lock = await this.prisma.idempotencyRecord.updateMany({
      where: {
        id: target.payment.idempotencyRecordId,
        status: 'COMPLETED',
        httpStatus: 200,
      },
      data: {
        httpStatus: 201,
      },
    });

    if (lock.count !== 1) {
      throw new ApiError(
        409,
        'REFUND_IN_PROGRESS',
        'Giao dịch đang trong quá trình xử lý hoàn tiền hoặc chờ đối soát, không gửi hoàn tiền trùng lặp',
      );
    }

    const ipAddr =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    const gatewayResult = await this.vnpay.refundTransaction({
      txnRef: target.txnRef,
      transactionDate: target.payDate,
      orderCode: target.order.code,
      amount: target.payment.amount,
      transactionNo: target.transactionNo,
      createBy: user.email,
      ipAddr,
    });

    if (gatewayResult.outcome === 'UNCERTAIN') {
      // Giữ khóa (httpStatus = 201) + đánh dấu PENDING_RECONCILIATION để chặn gửi hoàn tiền trùng khi chưa rõ kết quả
      await this.prisma.idempotencyRecord.update({
        where: { id: target.payment.idempotencyRecordId },
        data: {
          status: 'COMPLETED',
          httpStatus: 201,
          response: {
            ...target.meta,
            refundStatus: 'PENDING_RECONCILIATION',
            lastRefundResponseCode: gatewayResult.vnp_ResponseCode,
            lastRefundMessage: gatewayResult.vnp_Message,
          },
        },
      });

      throw new ApiError(
        502,
        'VNPAY_REFUND_UNCERTAIN',
        'Chưa xác nhận được kết quả hoàn tiền từ cổng VNPay. Giao dịch được giữ ở trạng thái chờ đối soát, không gửi hoàn tiền lặp.',
      );
    }

    if (gatewayResult.outcome === 'REJECTED') {
      // VNPay từ chối hoàn tiền rõ ràng -> mở khóa lại (httpStatus = 200), không đổi trạng thái đơn và payment
      await this.prisma.idempotencyRecord.update({
        where: { id: target.payment.idempotencyRecordId },
        data: {
          status: 'COMPLETED',
          httpStatus: 200,
          response: {
            ...target.meta,
            refundStatus: 'FAILED',
            lastRefundResponseCode: gatewayResult.vnp_ResponseCode,
            lastRefundMessage: gatewayResult.vnp_Message,
          },
        },
      });

      throw new ApiError(
        502,
        'VNPAY_REFUND_FAILED',
        `Cổng VNPay từ chối hoàn tiền: ${gatewayResult.vnp_Message} (Mã: ${gatewayResult.vnp_ResponseCode})`,
      );
    }

    // Chỉ khi VNPay xác nhận thành công (outcome === 'SUCCEEDED' / vnp_ResponseCode === '00')
    try {
      await this.prisma.$transaction(async (tx) => {
        const currentOrder = await tx.order.findUnique({
          where: { id: target.order.id },
          include: { items: { include: { toppings: true } } },
        });

        if (!currentOrder || currentOrder.status !== 'PAID') {
          throw new ApiError(
            409,
            'ORDER_NOT_REFUNDABLE',
            'Trạng thái đơn hàng đã thay đổi, không thể hoàn tất hủy đơn',
          );
        }

        await this.orderTransactions.transition(tx, {
          orderId: currentOrder.id,
          actorUserId: user.id,
          expectedVersion: currentOrder.version,
          toStatus: 'CANCELLED',
        });

        await tx.payment.update({
          where: { id: target.payment.id },
          data: { status: 'REFUNDED' },
        });

        await this.loyaltyTransactions.reverse(tx, currentOrder);

        await tx.idempotencyRecord.update({
          where: { id: target.payment.idempotencyRecordId },
          data: {
            status: 'COMPLETED',
            httpStatus: 200,
            response: {
              ...target.meta,
              refundStatus: 'REFUNDED',
              refundTransactionNo: gatewayResult.vnp_TransactionNo,
              refundResponseCode: gatewayResult.vnp_ResponseCode,
            },
          },
        });
      });
    } catch (error) {
      // Nếu lỗi nội bộ khi cập nhật DB sau khi VNPay đã hoàn tiền, giữ dấu vết đối soát
      await this.prisma.idempotencyRecord.update({
        where: { id: target.payment.idempotencyRecordId },
        data: {
          status: 'COMPLETED',
          httpStatus: 201,
          response: {
            ...target.meta,
            refundStatus: 'PENDING_RECONCILIATION',
          },
        },
      });
      throw error;
    }

    const updatedPayment = await this.prisma.payment.findUnique({
      where: { id: target.payment.id },
      include: { order: true },
    });

    return {
      success: true,
      message: `Hoàn tiền VNPay thành công 100% (${target.payment.amount.toLocaleString('vi-VN')} ₫) cho đơn ${target.order.code}`,
      transaction: {
        paymentId: target.payment.id,
        orderId: target.order.id,
        orderCode: target.order.code,
        orderStatus: updatedPayment?.order.status ?? 'CANCELLED',
        paymentStatus: updatedPayment?.status ?? 'REFUNDED',
        amount: target.payment.amount,
        transactionNo: target.transactionNo,
        txnRef: target.txnRef,
        bankCode: target.bankCode,
        bankTranNo: target.bankTranNo,
        cardType: target.cardType,
        payDate: target.payDate,
      },
      gateway: gatewayResult,
    };
  }

  /**
   * Băm thông tin phiên thanh toán (orderId, orderCode, txnRef, tmnCode, amount) thành SHA-256 64 ký tự
   */
  private computeAttemptHash(input: {
    orderId: string;
    orderCode: string;
    txnRef: string;
    tmnCode: string;
    amount: number;
  }): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          orderId: input.orderId,
          orderCode: input.orderCode,
          txnRef: input.txnRef,
          tmnCode: input.tmnCode,
          amount: input.amount,
        }),
      )
      .digest('hex');
  }

  /**
   * Đối chiếu vnp_TxnRef và vnp_TmnCode từ callback với phiên thanh toán đã lưu trong IdempotencyRecord
   */
  private async findSavedVnPayAttempt(result: VnPayVerifyResult) {
    if (!result.txnRef) return null;

    const attemptRecord = await this.prisma.idempotencyRecord.findFirst({
      where: {
        scope: 'PAY_ORDER',
        key: result.txnRef,
      },
    });

    if (!attemptRecord) return null;

    const savedMeta = (attemptRecord.response ?? {}) as Record<string, unknown>;
    if (savedMeta.txnRef && savedMeta.txnRef !== result.txnRef) {
      return null;
    }
    if (savedMeta.tmnCode && savedMeta.tmnCode !== result.tmnCode) {
      return null;
    }

    const orderId = typeof savedMeta.orderId === 'string' ? savedMeta.orderId : '';
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
    const order = await this.prisma.order.findFirst({
      where: isUuid
        ? { id: orderId, userId: attemptRecord.userId }
        : {
            userId: attemptRecord.userId,
            OR: [{ code: result.orderIdFromRef }, { code: result.orderCode }],
          },
      include: { items: { include: { toppings: true } } },
    });

    if (!order) return null;

    const expectedHash = this.computeAttemptHash({
      orderId: order.id,
      orderCode: order.code,
      txnRef: result.txnRef,
      tmnCode: result.tmnCode,
      amount: order.total,
    });
    if (attemptRecord.requestHash !== expectedHash) {
      return null;
    }

    return { order, attemptRecord, savedMeta };
  }

  /**
   * Ghi nhận kết quả callback (Return URL hoặc IPN) một cách nguyên tử, chống ghi trùng khi gọi đồng thời
   */
  private async settleVnPayCallback(
    orderId: string,
    attemptRecordId: string,
    savedMeta: Record<string, unknown>,
    result: VnPayVerifyResult,
  ): Promise<{ alreadyConfirmed: boolean }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        let current = await tx.order.findUnique({
          where: { id: orderId },
          include: { items: { include: { toppings: true } } },
        });

        if (!current) {
          return { alreadyConfirmed: true };
        }

        const claim = await tx.idempotencyRecord.updateMany({
          where: { id: attemptRecordId, status: 'PROCESSING' },
          data: {
            status: 'COMPLETED',
            httpStatus: 200,
            response: {
              ...savedMeta,
              provider: 'VNPAY',
              orderId: current.id,
              orderCode: current.code,
              expectedAmount: current.total,
              success: result.isSuccess,
              transactionNo: result.transactionNo ?? '',
              txnRef: result.txnRef,
              tmnCode: result.tmnCode,
              bankCode: result.bankCode ?? 'NCB',
              bankTranNo: result.bankTranNo ?? '',
              cardType: result.cardType ?? 'ATM',
              payDate: result.payDate ?? '',
              responseCode: result.responseCode,
              transactionStatus: result.transactionStatus,
            },
          },
        });

        if (claim.count === 0) {
          return { alreadyConfirmed: true };
        }

        if (result.isSuccess) {
          if (current.status !== 'PENDING' && current.status !== 'PAYMENT_FAILED') {
            return { alreadyConfirmed: true };
          }

          if (current.status === 'PAYMENT_FAILED') {
            current = await this.orderTransactions.prepareRetry(tx, current);
          }

          await this.orderTransactions.transition(tx, {
            orderId: current.id,
            actorUserId: current.userId,
            expectedVersion: current.version,
            toStatus: 'PAID',
          });

          await tx.payment.create({
            data: {
              orderId: current.id,
              idempotencyRecordId: attemptRecordId,
              idempotencyKey: result.txnRef,
              amount: current.total,
              method: 'CARD',
              status: 'SUCCEEDED',
            },
          });

          return { alreadyConfirmed: false };
        }

        // Giao dịch thất bại hoặc bị khách hủy
        if (current.status === 'PENDING') {
          await this.orderTransactions.transition(tx, {
            orderId: current.id,
            actorUserId: current.userId,
            expectedVersion: current.version,
            toStatus: 'PAYMENT_FAILED',
          });
        }

        await tx.payment.create({
          data: {
            orderId: current.id,
            idempotencyRecordId: attemptRecordId,
            idempotencyKey: result.txnRef,
            amount: current.total,
            method: 'CARD',
            status: 'FAILED',
          },
        });

        return { alreadyConfirmed: false };
      });
    } catch (error: unknown) {
      const errCode =
        error instanceof ApiError
          ? (error.getResponse() as { code?: string } | undefined)?.code
          : undefined;
      if (isUniqueConstraintError(error) || errCode === 'ORDER_VERSION_CONFLICT') {
        return { alreadyConfirmed: true };
      }
      throw error;
    }
  }

  private async findTargetVnPayPayment(body: VnPayActionDto, user: CurrentUserData) {
    const hasFilter = Boolean(
      body.paymentId?.trim() ||
        body.orderId?.trim() ||
        body.orderCode?.trim() ||
        body.transactionNo?.trim(),
    );
    if (!hasFilter) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Vui lòng cung cấp paymentId, orderId, orderCode hoặc transactionNo',
      );
    }

    const payments = await this.prisma.payment.findMany({
      where:
        user.role === 'STAFF'
          ? { method: 'CARD' }
          : { method: 'CARD', order: { userId: user.id } },
      include: {
        order: true,
        idempotency: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const match = payments.find((p) => {
      const meta = (p.idempotency?.response ?? {}) as Record<string, unknown>;
      const txNo = typeof meta.transactionNo === 'string' ? meta.transactionNo : '';
      if (body.paymentId && p.id === body.paymentId.trim()) return true;
      if (body.orderId && p.orderId === body.orderId.trim()) return true;
      if (body.orderCode && p.order.code.toLowerCase() === body.orderCode.trim().toLowerCase()) return true;
      if (body.transactionNo && txNo === body.transactionNo.trim()) return true;
      return false;
    });

    if (!match) return null;

    const meta = (match.idempotency?.response ?? {}) as Record<string, unknown>;
    const transactionNo =
      typeof meta.transactionNo === 'string' && meta.transactionNo.length > 0
        ? meta.transactionNo
        : match.id.slice(0, 8);
    const txnRef =
      typeof meta.txnRef === 'string' && meta.txnRef.length > 0
        ? meta.txnRef
        : match.idempotencyKey;
    const bankCode =
      typeof meta.bankCode === 'string' && meta.bankCode.length > 0
        ? meta.bankCode
        : 'NCB';
    const bankTranNo =
      typeof meta.bankTranNo === 'string' && meta.bankTranNo.length > 0
        ? meta.bankTranNo
        : `VNP${transactionNo}`;
    const cardType =
      typeof meta.cardType === 'string' && meta.cardType.length > 0
        ? meta.cardType
        : 'ATM';
    const payDate =
      typeof meta.payDate === 'string' && meta.payDate.length > 0
        ? meta.payDate
        : this.toVnPayDateString(match.createdAt);

    return {
      payment: match,
      order: match.order,
      meta,
      transactionNo,
      txnRef,
      bankCode,
      bankTranNo,
      cardType,
      payDate,
    };
  }

  private toVnPayDateString(date: Date): string {
    const vnOffset = 7 * 60;
    const utc = date.getTime() + date.getTimezoneOffset() * 60000;
    const vnTime = new Date(utc + vnOffset * 60000);
    const year = vnTime.getFullYear();
    const month = String(vnTime.getMonth() + 1).padStart(2, '0');
    const day = String(vnTime.getDate()).padStart(2, '0');
    const hours = String(vnTime.getHours()).padStart(2, '0');
    const minutes = String(vnTime.getMinutes()).padStart(2, '0');
    const seconds = String(vnTime.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }
}
