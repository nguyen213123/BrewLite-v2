import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { StripeService } from '../src/modules/payments/stripe.service';
import { OrdersService } from '../src/modules/orders/orders.service';

describe('StripeService & Stripe Integration', () => {
  let stripeService: StripeService;
  let configService: ConfigService;

  beforeEach(() => {
    configService = new ConfigService({
      STRIPE_SECRET_KEY: 'sk_test_mock_123',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_mock_123',
      STRIPE_RETURN_URL: 'http://localhost:3000/payments/stripe-return',
    });
    stripeService = new StripeService(configService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('StripeService', () => {
    it.each([0, -1, 0.5])('never sends a zero/invalid refund amount to Stripe (%s)', async amount => {
      const api = jest.spyOn(globalThis, 'fetch');
      const result = await stripeService.refundPayment({ paymentIntentId: 'pi_test', amount });
      expect(result.outcome).toBe('FAILED');
      expect(api).not.toHaveBeenCalled();
    });
    it.each([
      ['complete', 'no_payment_required', 0, true],
      ['open', 'no_payment_required', 0, false],
      ['complete', 'no_payment_required', 35000, false],
      ['complete', 'unpaid', 0, false],
      ['complete', 'paid', -1, false],
      ['complete', 'no_payment_required', undefined, false],
    ] as const)('handles free checkout safely: %s/%s/%s', async (status, paymentStatus, amount, accepted) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        status, payment_status: paymentStatus, amount_total: amount,
        metadata: { orderId: 'order-free', orderCode: 'BL-FREE', stripeRef: 'free-ref' },
      })));
      const result = await stripeService.verifySession('cs_free');
      expect(result.isPaid).toBe(accepted);
    });
    it('verifies the original webhook bytes, supports rotated signatures, and rejects tampering and stale events', () => {
      const secret = 'whsec_test_only';
      const service = new StripeService(new ConfigService({ STRIPE_WEBHOOK_SECRET: secret }));
      const payload = Buffer.from('{ "type": "checkout.session.completed", "data": { "object": { "id": "cs_test" } } }');
      const timestamp = Math.floor(Date.now() / 1000);
      const sign = (time: number, bytes = payload) => createHmac('sha256', secret).update(`${time}.`).update(bytes).digest('hex');
      const signature = `t=${timestamp},v1=${'0'.repeat(64)},v1=${sign(timestamp)}`;
      expect(service.verifyWebhook(payload, signature)).toEqual({ type: 'checkout.session.completed', sessionId: 'cs_test' });
      expect(() => service.verifyWebhook(Buffer.concat([payload, Buffer.from(' ')]), signature)).toThrow();
      expect(() => service.verifyWebhook(payload, `t=${timestamp - 600},v1=${sign(timestamp - 600)}`)).toThrow();
      expect(() => service.verifyWebhook(undefined, signature)).toThrow();
      expect(() => service.verifyWebhook(payload, undefined)).toThrow();
      const malformed = Buffer.from('not-json');
      expect(() => service.verifyWebhook(malformed, `t=${timestamp},v1=${sign(timestamp, malformed)}`)).toThrow();
    });
    it.each(['pending', 'requires_action', 'failed', 'canceled'])('does not confirm an unfinished refund (%s)', async status => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 're_test', status })));
      const result = await stripeService.refundPayment({ paymentIntentId: 'pi_test', idempotencyKey: 'refund-key' });
      expect(result.outcome).toBe(['failed', 'canceled'].includes(status) ? 'FAILED' : 'UNCERTAIN');
      expect(result.refundId).toBe('re_test');
    });

    it('retrieves a pending refund instead of creating another refund', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 're_test', status: 'succeeded' })));
      expect((await stripeService.refundPayment({ paymentIntentId: 'pi_test', refundId: 're_test' })).outcome).toBe('SUCCESS');
      expect(fetchSpy).toHaveBeenCalledWith('https://api.stripe.com/v1/refunds/re_test', expect.objectContaining({ method: 'GET', body: undefined }));
    });

    it('uses a stable idempotency key and keeps server errors uncertain', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
      expect((await stripeService.refundPayment({ paymentIntentId: 'pi_test', idempotencyKey: 'refund-key' })).outcome).toBe('UNCERTAIN');
      expect(fetchSpy).toHaveBeenCalledWith('https://api.stripe.com/v1/refunds', expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': 'refund-key' }) }));
    });
    it('báo lỗi rõ ràng khi thiếu STRIPE_SECRET_KEY', async () => {
      const emptyConfig = new ConfigService({
        STRIPE_SECRET_KEY: '',
      });
      delete process.env.STRIPE_SECRET_KEY;
      const service = new StripeService(emptyConfig);
      await expect(
        service.createCheckoutSession({
          orderId: 'o-1',
          orderCode: 'ORD-1',
          amount: 50000,
          items: [{ name: 'Espresso', quantity: 1, price: 50000 }],
        }),
      ).rejects.toThrow('STRIPE_CONFIG_MISSING');
    });

    it('tạo checkout session thành công với tham số chuẩn xác', async () => {
      const mockSession = {
        id: 'cs_test_abc123',
        url: 'https://checkout.stripe.com/c/pay/cs_test_abc123',
        payment_intent: 'pi_test_abc123',
      };

      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockSession), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const res = await stripeService.createCheckoutSession({
        orderId: 'order-123',
        orderCode: 'ORD-123',
        amount: 35000,
        items: [{ name: 'Cà phê Muối', quantity: 1, price: 35000 }],
      });

      expect(res.sessionId).toBe('cs_test_abc123');
      expect(res.url).toBe('https://checkout.stripe.com/c/pay/cs_test_abc123');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.stripe.com/v1/checkout/sessions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_test_mock_123',
          }),
        }),
      );
    });

    it('xác thực phiên thanh toán: thành công khi payment_status = paid và status = complete', async () => {
      const mockSession = {
        id: 'cs_test_abc123',
        status: 'complete',
        payment_status: 'paid',
        client_reference_id: 'order-123',
        amount_total: 35000,
        payment_intent: 'pi_test_abc123',
      };

      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockSession), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await stripeService.verifySession('cs_test_abc123');
      expect(result.isValid).toBe(true);
      expect(result.isPaid).toBe(true);
      expect(result.orderId).toBe('order-123');
      expect(result.amount).toBe(35000);
      expect(result.paymentIntentId).toBe('pi_test_abc123');
    });

    it('xác thực phiên thanh toán: từ chối khi payment_status != paid', async () => {
      const mockSession = {
        id: 'cs_test_abc123',
        status: 'open',
        payment_status: 'unpaid',
        client_reference_id: 'order-123',
        amount_total: 35000,
      };

      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockSession), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await stripeService.verifySession('cs_test_abc123');
      expect(result.isValid).toBe(true);
      expect(result.isPaid).toBe(false);
    });

    it('hoàn tiền thành công qua Stripe Refund API', async () => {
      const mockRefund = {
        id: 're_test_xyz789',
        status: 'succeeded',
        amount: 35000,
      };

      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockRefund), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await stripeService.refundPayment({
        paymentIntentId: 'pi_test_abc123',
        amount: 35000,
        reason: 'Khách yêu cầu hủy đơn',
      });

      expect(result.outcome).toBe('SUCCESS');
      expect(result.refundId).toBe('re_test_xyz789');
      expect(result.status).toBe('succeeded');
    });
  });

  describe('OrdersService.cancel với Stripe', () => {
    it('tự động hoàn tiền Stripe khi đơn PAID bị hủy', async () => {
      const refundSpy = jest.spyOn(stripeService, 'refundPayment').mockResolvedValueOnce({
        outcome: 'SUCCESS',
        refundId: 're_test_999',
        status: 'succeeded',
        message: 'Thành công',
      });

      const orderRow = {
        id: 'order-stripe-1',
        code: 'ORD-STRIPE-1',
        userId: 'user-1',
        status: 'PAID',
        subtotal: 50000,
        discount: 0,
        total: 50000,
        pointsEarned: 0,
        pointsRedeemed: 0,
        promotionId: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
        payments: [
          {
            id: 'pay-1',
            orderId: 'order-stripe-1',
            amount: 50000,
            status: 'SUCCEEDED',
            idempotencyKey: 'cs_test_12345',
            idempotencyRecordId: 'idem-1',
            idempotency: {
              response: {
                provider: 'STRIPE',
                paymentIntentId: 'pi_test_12345',
                sessionId: 'cs_test_12345',
              },
            },
          },
        ],
      };

      const prismaMock = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        order: {
          findUnique: jest.fn().mockResolvedValue(orderRow),
          findFirst: jest.fn().mockResolvedValue(orderRow),
          update: jest.fn().mockResolvedValue({ ...orderRow, status: 'CANCELLED', version: 2 }),
        },
        orderItem: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        payment: {
          findUnique: jest.fn().mockResolvedValue({ status: 'SUCCEEDED' }),
          update: jest.fn().mockResolvedValue({}),
        },
        idempotencyRecord: {
          findUnique: jest.fn().mockResolvedValue({ httpStatus: 200, response: {} }),
          update: jest.fn().mockResolvedValue({}),
        },
      };

      const uowMock = {
        run: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
      };

      const transitionsMock = {
        loadOwned: jest.fn().mockResolvedValue(orderRow),
        transition: jest.fn().mockResolvedValue({
          ...orderRow,
          status: 'CANCELLED',
          version: 2,
        }),
      };

      const loyaltyMock = {
        earn: jest.fn(),
        reverse: jest.fn().mockResolvedValue(undefined),
      };

      const ordersService = new OrdersService(
        uowMock as never,
        {} as never,
        {} as never,
        {} as never,
        transitionsMock as never,
        loyaltyMock as never,
        {} as never,
        prismaMock as never,
        {} as never,
        stripeService,
      );

      const result = await ordersService.cancel('user-1', 'order-stripe-1', 1);

      expect(refundSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentIntentId: 'pi_test_12345',
          amount: 50000,
        }),
      );
      expect(transitionsMock.transition).toHaveBeenCalledWith(
        prismaMock,
        expect.objectContaining({
          orderId: 'order-stripe-1',
          actorUserId: 'user-1',
          expectedVersion: 1,
          toStatus: 'CANCELLED',
        }),
      );
      expect(result.status).toBe('CANCELLED');
    });
  });
});
