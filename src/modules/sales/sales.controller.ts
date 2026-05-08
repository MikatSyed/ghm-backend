import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ListSalesQueryDto } from './dto/list-sales.query';
import { SalesService } from './sales.service';

@ApiTags('sales')
@ApiBearerAuth()
@Controller({ path: 'sales', version: '1' })
export class SalesController {
  constructor(private readonly service: SalesService) {}

  @Post()
  @ApiOperation({ summary: 'Finalize sale cycle → create invoice + record revenue' })
  finalize(@Body() dto: CreateSaleDto) {
    return this.service.finalize(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List sales (filter by vanId, dateFrom, dateTo)' })
  list(@Query() q: ListSalesQueryDto) {
    return this.service.findAll(q);
  }

  @Get('last')
  @ApiOperation({ summary: 'Last sale for a given van' })
  last(@Query('vanId') vanId: string) {
    return this.service.lastForVan(vanId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get sale by id with items + invoice' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Void sale: reverse FIFO allocations (return stock to van), soft-delete sale + invoice. Blocked if invoice already paid.',
  })
  async void(@Param('id') id: string): Promise<void> {
    await this.service.void(id);
  }
}
