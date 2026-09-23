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
import { StockBatchesService } from './stock-batches.service';
import { CreateStockBatchDto } from './dto/create-stock-batch.dto';
import { ListStockBatchesQueryDto } from './dto/list-stock-batches.query';

@ApiTags('stock-batches')
@ApiBearerAuth()
@Controller({ path: 'stock-batches', version: '1' })
export class StockBatchesController {
  constructor(private readonly service: StockBatchesService) {}

  @Get()
  @ApiOperation({ summary: 'List stock batches' })
  list(@Query() q: ListStockBatchesQueryDto) {
    return this.service.findAll(q);
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a stock batch with one or more product lines; auto-creates StockEntry per line',
  })
  create(@Body() dto: CreateStockBatchDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get batch with all entries and linked purchases' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft-delete a batch and its entries (blocked if any entry is consumed downstream)',
  })
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }
}
