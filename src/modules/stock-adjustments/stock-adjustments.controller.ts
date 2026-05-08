import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ByLotQueryDto } from './dto/by-lot.query';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { ListStockAdjustmentsQueryDto } from './dto/list-stock-adjustments.query';
import { StockAdjustmentsService } from './stock-adjustments.service';

@ApiTags('stock-adjustments')
@ApiBearerAuth()
@Controller({ path: 'stock-adjustments', version: '1' })
export class StockAdjustmentsController {
  constructor(private readonly service: StockAdjustmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List stock adjustments' })
  list(@Query() q: ListStockAdjustmentsQueryDto) {
    return this.service.findAll(q);
  }

  @Get('by-lot')
  @ApiOperation({
    summary:
      'Aggregate adjustments per stock entry (lot). Returns total adjusted, breakdown by reason, and full adjustment history per STK.',
  })
  byLot(@Query() q: ByLotQueryDto) {
    return this.service.byLot(q);
  }

  @Get('audit')
  @ApiOperation({
    summary: 'Paginated audit log for all stock adjustments (CREATE / DELETE entries).',
  })
  audit(@Query() q: PaginationQueryDto) {
    return this.service.auditAll({ page: q.page, pageSize: q.pageSize, skip: q.skip, take: q.take });
  }

  @Post()
  @ApiOperation({ summary: 'Record damage / wastage / correction; decrements warehouse stock if WAREHOUSE' })
  create(@Body() dto: CreateStockAdjustmentDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/history')
  @ApiOperation({
    summary: 'Audit trail for a stock adjustment: AuditLog entries, financial transactions, and lot allocations.',
  })
  history(@Param('id') id: string) {
    return this.service.history(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete and reverse warehouse stock effect' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
