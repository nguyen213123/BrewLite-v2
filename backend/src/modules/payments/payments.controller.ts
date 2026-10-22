import { Body, Controller, HttpCode, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PaymentsPort } from '../../common/contracts/ports';
import { EmptyQueryDto } from '../../common/dto/shared.dto';
import { CurrentUser, IdempotencyKey, JwtAuthGuard } from '../../common/security/security';
import type { CurrentUserData } from '../../common/security/security';
import { CreatePaymentDto } from './dto/payment.dto';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsPort) {}
  @Post() @HttpCode(200)
  async pay(@CurrentUser() user: CurrentUserData, @IdempotencyKey() key: string, @Body() input: CreatePaymentDto,
    @Query() _query: EmptyQueryDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.payments.pay(user.id, key, input);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return result.data;
  }
}
