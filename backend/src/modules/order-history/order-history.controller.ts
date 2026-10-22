import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { OrderReadPort } from '../../common/contracts/ports';
import { EmptyQueryDto, IdParamDto, PaginationDto } from '../../common/dto/shared.dto';
import { CurrentUser, JwtAuthGuard } from '../../common/security/security';
import type { CurrentUserData } from '../../common/security/security';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrderHistoryController {
  constructor(private readonly orders: OrderReadPort) {}
  // Static /me must precede /:id. TV4 owns both read routes in this controller.
  @Get('me')
  list(@CurrentUser() user: CurrentUserData, @Query() query: PaginationDto) { return this.orders.listMine(user.id, query); }
  @Get(':id')
  detail(@CurrentUser() user: CurrentUserData, @Param() params: IdParamDto, @Query() _query: EmptyQueryDto) {
    return this.orders.findMine(user.id, params.id);
  }
}
