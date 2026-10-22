import { Body, Controller, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { OrdersPort } from '../../common/contracts/ports';
import { EmptyQueryDto, IdParamDto } from '../../common/dto/shared.dto';
import { CurrentUser, IdempotencyKey, JwtAuthGuard, StaffGuard } from '../../common/security/security';
import type { CurrentUserData } from '../../common/security/security';
import { CancelOrderDto, CreateOrderDto, TransitionOrderDto } from './dto/orders.dto';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersPort) {}
  @Post('quote') @HttpCode(200)
  quote(@CurrentUser() user: CurrentUserData, @Body() input: CreateOrderDto, @Query() _query: EmptyQueryDto) {
    return this.orders.quote(user.id, input);
  }
  @Post()
  async create(@CurrentUser() user: CurrentUserData, @IdempotencyKey() key: string, @Body() input: CreateOrderDto,
    @Query() _query: EmptyQueryDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.orders.create(user.id, key, input);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return result.data;
  }
  @Post(':id/cancel') @HttpCode(200)
  cancel(@CurrentUser() user: CurrentUserData, @Param() params: IdParamDto, @Body() input: CancelOrderDto, @Query() _query: EmptyQueryDto) {
    return this.orders.cancel(user.id, params.id, input.expectedVersion);
  }
  @Patch(':id/status') @UseGuards(StaffGuard)
  transition(@CurrentUser() user: CurrentUserData, @Param() params: IdParamDto, @Body() input: TransitionOrderDto, @Query() _query: EmptyQueryDto) {
    return this.orders.transition(user.id, params.id, input);
  }
}
