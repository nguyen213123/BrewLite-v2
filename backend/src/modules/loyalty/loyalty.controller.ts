import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { LoyaltyPort } from '../../common/contracts/ports';
import { EmptyQueryDto, PaginationDto } from '../../common/dto/shared.dto';
import { CurrentUser, JwtAuthGuard } from '../../common/security/security';
import type { CurrentUserData } from '../../common/security/security';

@Controller('loyalty/me')
@UseGuards(JwtAuthGuard)
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyPort) {}
  @Get()
  balance(@CurrentUser() user: CurrentUserData, @Query() _query: EmptyQueryDto) { return this.loyalty.balance(user.id); }
  @Get('entries')
  entries(@CurrentUser() user: CurrentUserData, @Query() query: PaginationDto) { return this.loyalty.entries(user.id, query); }
}
