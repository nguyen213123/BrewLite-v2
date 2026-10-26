import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { PromotionsPort } from '../../common/contracts/ports';
import { EmptyQueryDto } from '../../common/dto/shared.dto';
import { CurrentUser, JwtAuthGuard } from '../../common/security/security';
import type { CurrentUserData } from '../../common/security/security';
import { ValidatePromotionDto } from './dto/promotion.dto';

@Controller('promotions')
@UseGuards(JwtAuthGuard)
export class PromotionsController {
  constructor(private readonly promotions: PromotionsPort) {}
  @Get()
  list(@Query() _query: EmptyQueryDto) {
    return this.promotions.listActive ? this.promotions.listActive() : [];
  }
  @Post('validate') @HttpCode(200)
  validate(@CurrentUser() user: CurrentUserData, @Body() input: ValidatePromotionDto, @Query() _query: EmptyQueryDto) {
    return this.promotions.validate(user.id, input);
  }
}
