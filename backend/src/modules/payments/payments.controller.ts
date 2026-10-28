import { createHash, randomUUID } from 'node:crypto';
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
import { OrderTransactionsPort, PaymentsPort } from '../../common/contracts/ports';
import { EmptyQueryDto } from '../../common/dto/shared.dto';
import { ApiError } from '../../common/errors/api-error';
import { CurrentUser, IdempotencyKey, JwtAuthGuard } from '../../common/security/security';
import type { CurrentUserData } from '../../common/security/security';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePaymentDto,
  CreateVnPayUrlDto,
  VnPayActionDto,
  VnPayQueryDto,
} from './dto/payment.dto';
import { VnPayService } from './vnpay.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsPort,
    private readonly vnpay: VnPayService,
    private readonly prisma: PrismaService,
    private readonly orderTransactions: OrderTransactionsPort,
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
   * Tạo URL thanh toán VNPay Sandbox
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

    if (order.status === 'PAYMENT_FAILED') {
      await this.prisma.$transaction(async (tx) => {
        await this.orderTransactions.prepareRetry(tx, order);
      });
    }

    const ipAddr =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    const paymentUrl = this.vnpay.createPaymentUrl({
      orderId: order.id,
      orderCode: order.code,
      amount: order.total,
      ipAddr,
    });

    return {
      paymentUrl,
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
        message: 'Chữ ký số không hợp lệ hoặc dữ liệu bị thay đổi',
        orderCode: result.orderCode,
        responseCode: result.responseCode,
      };
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.orderIdFromRef);
    const order = await this.prisma.order.findFirst({
      where: isUuid
        ? { id: result.orderIdFromRef }
        : { OR: [{ code: result.orderIdFromRef }, { code: result.orderCode }] },
      include: { items: { include: { toppings: true } } },
    });

    if (!order) {
      return {
        success: false,
        message: 'Không tìm thấy đơn hàng tương ứng',
        orderCode: result.orderCode,
        responseCode: result.responseCode,
      };
    }

    // Nếu đơn hàng đã hoàn thành hoặc đã hoàn tiền trước đó (idempotency khi F5 trang kết quả)
    if (order.status !== 'PENDING' && order.status !== 'PAYMENT_FAILED') {
      return {
        success: true,
        message:
          order.status === 'CANCELLED'
            ? 'Giao dịch VNPay này đã được hoàn tiền (Refunded)'
            : 'Đơn hàng đã được thanh toán thành công',
        orderCode: order.code,
        orderId: order.id,
        amount: order.total,
        bankCode: result.bankCode,
        transactionNo: result.transactionNo,
        responseCode: result.responseCode,
      };
    }

    // Nếu giao dịch VNPay thành công (ResponseCode '00')
    if (result.isSuccess) {
      await this.prisma.$transaction(async (tx) => {
        let current = await tx.order.findUnique({
          where: { id: order.id },
          include: { items: { include: { toppings: true } } },
        });
        if (!current || (current.status !== 'PENDING' && current.status !== 'PAYMENT_FAILED')) return;

        if (current.status === 'PAYMENT_FAILED') {
          current = await this.orderTransactions.prepareRetry(tx, current);
        }

        await this.orderTransactions.transition(tx, {
          orderId: order.id,
          actorUserId: order.userId,
          expectedVersion: current.version,
          toStatus: 'PAID',
        });

        const idempotencyKey = randomUUID();
        const requestHash = createHash('sha256')
          .update(JSON.stringify({ orderId: order.id, transactionNo: result.transactionNo }))
          .digest('hex');

        const idempotencyRecord = await tx.idempotencyRecord.create({
          data: {
            userId: order.userId,
            scope: 'PAY_ORDER',
            key: idempotencyKey,
            requestHash,
            status: 'COMPLETED',
            httpStatus: 200,
            response: {
              success: true,
              transactionNo: result.transactionNo ?? '',
              txnRef: result.txnRef,
              bankCode: result.bankCode ?? 'NCB',
              bankTranNo: result.bankTranNo ?? '',
              cardType: result.cardType ?? 'ATM',
              payDate: result.payDate ?? '',
              responseCode: result.responseCode,
            },
          },
          select: { id: true },
        });

        // Tạo bản ghi Payment
        await tx.payment.create({
          data: {
            orderId: order.id,
            idempotencyRecordId: idempotencyRecord.id,
            idempotencyKey,
            amount: order.total,
            method: 'CARD',
            status: 'SUCCEEDED',
          },
        });
      });

      return {
        success: true,
        message: 'Thanh toán VNPay thành công',
        orderCode: order.code,
        orderId: order.id,
        amount: order.total,
        bankCode: result.bankCode,
        transactionNo: result.transactionNo,
        responseCode: result.responseCode,
      };
    }

    // Nếu khách hủy hoặc giao dịch thất bại
    if (order.status === 'PENDING') {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.order.findUnique({
          where: { id: order.id },
          include: { items: { include: { toppings: true } } },
        });
        if (!current || current.status !== 'PENDING') return;

        await this.orderTransactions.transition(tx, {
          orderId: order.id,
          actorUserId: order.userId,
          expectedVersion: current.version,
          toStatus: 'PAYMENT_FAILED',
        });
      });
    }

    return {
      success: false,
      message: result.message,
      orderCode: order.code,
      orderId: order.id,
      amount: order.total,
      responseCode: result.responseCode,
    };
  }

  /**
   * Endpoint IPN (Instant Payment Notification) Server-to-Server theo chuẩn VNPay
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

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.orderIdFromRef);
    const order = await this.prisma.order.findFirst({
      where: isUuid
        ? { id: result.orderIdFromRef }
        : { OR: [{ code: result.orderIdFromRef }, { code: result.orderCode }] },
      include: { items: { include: { toppings: true } } },
    });

    if (!order) {
      return { RspCode: '01', Message: 'Order not found' };
    }

    if (order.total !== result.amount) {
      return { RspCode: '04', Message: 'Invalid amount' };
    }

    if (order.status === 'PAID') {
      return { RspCode: '02', Message: 'Order already confirmed' };
    }

    if (result.isSuccess) {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.order.findUnique({
          where: { id: order.id },
          include: { items: { include: { toppings: true } } },
        });
        if (!current || current.status === 'PAID') return;

        await this.orderTransactions.transition(tx, {
          orderId: order.id,
          actorUserId: order.userId,
          expectedVersion: current.version,
          toStatus: 'PAID',
        });

        await tx.payment.create({
          data: {
            orderId: order.id,
            idempotencyRecordId: randomUUID(),
            idempotencyKey: `vnpay-ipn-${result.transactionNo ?? Date.now()}`,
            amount: order.total,
            method: 'CARD',
            status: 'SUCCEEDED',
          },
        });
      });
    }

    return { RspCode: '00', Message: 'Confirm Success' };
  }

  /**
   * Tra cứu danh sách lịch sử giao dịch VNPay Sandbox đã ghi nhận
   */
  @Get('vnpay/transactions')
  async listVnPayTransactions() {
    const payments = await this.prisma.payment.findMany({
      where: { method: 'CARD' },
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
          : p.order.code;
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

      return {
        paymentId: p.id,
        orderId: p.orderId,
        orderCode: p.order.code,
        orderStatus: p.order.status,
        paymentStatus: p.status,
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
   * Đối soát trực tiếp trạng thái giao dịch với cổng VNPay Sandbox (QueryDR)
   */
  @Post('vnpay/querydr')
  @HttpCode(200)
  async queryVnPayTransaction(
    @Body(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false }))
    body: VnPayActionDto,
    @Req() req: Request,
  ) {
    const target = await this.findTargetVnPayPayment(body);
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
      amount: target.payment.amount,
      transactionNo: target.transactionNo,
      bankCode: target.bankCode,
      isRefunded: target.payment.status === 'REFUNDED',
      ipAddr,
    });

    return {
      success: true,
      message:
        target.payment.status === 'REFUNDED'
          ? 'Đối soát thành công: Giao dịch đã hoàn tiền toàn phần (vnp_TransactionType = 02)'
          : 'Đối soát thành công: Giao dịch thanh toán hợp lệ trên cổng VNPay (vnp_ResponseCode = 00)',
      transaction: {
        paymentId: target.payment.id,
        orderId: target.order.id,
        orderCode: target.order.code,
        orderStatus: target.order.status,
        paymentStatus: target.payment.status,
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
   * Thực hiện hoàn tiền giao dịch qua VNPay Sandbox (Refund API) và hủy đơn / giải phóng tồn kho
   */
  @Post('vnpay/refund')
  @HttpCode(200)
  async refundVnPayTransaction(
    @Body(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false }))
    body: VnPayActionDto,
    @Req() req: Request,
  ) {
    const target = await this.findTargetVnPayPayment(body);
    if (!target) {
      throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Không tìm thấy giao dịch VNPay để hoàn tiền');
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
      bankCode: target.bankCode,
      createBy: 'customer@brewlite.local',
      ipAddr,
    });

    if (target.payment.status !== 'REFUNDED') {
      await this.prisma.$transaction(async (tx) => {
        const currentOrder = await tx.order.findUnique({
          where: { id: target.order.id },
          include: { items: { include: { toppings: true } } },
        });

        if (currentOrder && currentOrder.status === 'PAID') {
          await this.orderTransactions.transition(tx, {
            orderId: currentOrder.id,
            actorUserId: currentOrder.userId,
            expectedVersion: currentOrder.version,
            toStatus: 'CANCELLED',
          });
        }

        await tx.payment.update({
          where: { id: target.payment.id },
          data: { status: 'REFUNDED' },
        });
      });
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

  private async findTargetVnPayPayment(body: VnPayActionDto) {
    const payments = await this.prisma.payment.findMany({
      where: { method: 'CARD' },
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
      if (body.paymentId && p.id === body.paymentId) return true;
      if (body.orderId && p.orderId === body.orderId) return true;
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
        : match.order.code;
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
