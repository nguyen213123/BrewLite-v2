import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductsPort } from '../../common/contracts/ports';
import { EmptyQueryDto, IdParamDto, PaginationDto } from '../../common/dto/shared.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsPort) {}
  @Get()
  list(@Query() query: PaginationDto) { return this.products.list(query); }
  @Get(':id')
  detail(@Param() params: IdParamDto, @Query() _query: EmptyQueryDto) { return this.products.detail(params.id); }
}
