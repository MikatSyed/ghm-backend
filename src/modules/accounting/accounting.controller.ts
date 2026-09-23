import { Controller, DefaultValuePipe, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { dhakaDateString } from '../../common/util/dhaka-time';
import { AccountingService } from './accounting.service';
import { BatchVanProfitabilityService } from './batch-van-profitability.service';
import { BatchProfitabilityService } from './batch-profitability.service';
import { ListBatchVanProfitabilityQueryDto } from './dto/list-batch-van-profitability.query';
import { ListBatchProfitabilityQueryDto } from './dto/list-batch-profitability.query';

@ApiTags('accounting')
@ApiBearerAuth()
@Controller({ path: 'accounting', version: '1' })
export class AccountingController {
  constructor(
    private readonly service: AccountingService,
    private readonly batchProfitability: BatchProfitabilityService,
    private readonly batchVanProfitability: BatchVanProfitabilityService,
  ) {}

  @Get('ledger')
  @ApiOperation({ summary: 'Income statement for a month (YYYY-MM)' })
  ledger(@Query('month', new DefaultValuePipe(dhakaDateString().slice(0, 7))) month: string) {
    return this.service.ledger(month);
  }

  @Get('van-profitability')
  vanProfitability(
    @Query('month', new DefaultValuePipe(dhakaDateString().slice(0, 7))) month: string,
  ) {
    return this.service.vanProfitability(month);
  }

  @Get('batches')
  @ApiOperation({
    summary:
      'Batch-wise profit/loss: per-batch cost, sold revenue/COGS, realized profit, remaining ' +
      'unsold quantity, and potential profit if the remainder also sells.',
  })
  listBatches(@Query() q: ListBatchProfitabilityQueryDto) {
    return this.batchProfitability.listBatches(q);
  }

  @Get('batch-van-profitability')
  @ApiOperation({
    summary: 'Monthly batch-by-van assignment, sales, cost, profit/loss, and margin.',
  })
  listBatchVanProfitability(@Query() q: ListBatchVanProfitabilityQueryDto) {
    return this.batchVanProfitability.list(q);
  }

  @Get('batches/:batchId')
  @ApiOperation({ summary: 'Profit/loss detail for a single stock batch, broken down by product.' })
  getBatch(@Param('batchId') batchId: string) {
    return this.batchProfitability.getBatch(batchId);
  }
}
