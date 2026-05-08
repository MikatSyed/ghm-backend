import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateStockEntryDto } from './dto/create-stock-entry.dto';
import { ListStockEntriesQueryDto } from './dto/list-stock-entries.query';
import { StockEntriesService } from './stock-entries.service';

@ApiTags('stock-entries')
@ApiBearerAuth()
@Controller({ path: 'stock-entries', version: '1' })
export class StockEntriesController {
  constructor(private readonly service: StockEntriesService) {}

  @Get()
  @ApiOperation({ summary: 'List stock entries' })
  list(@Query() q: ListStockEntriesQueryDto) {
    return this.service.findAll(q);
  }

  @Post()
  @ApiOperation({ summary: 'Add stock; increments product stock' })
  create(@Body() dto: CreateStockEntryDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Soft-delete a stock entry; blocks if consumed by downstream records',
  })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
