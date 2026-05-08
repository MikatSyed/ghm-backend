import { Controller, DefaultValuePipe, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { dhakaDateString } from '../../common/util/dhaka-time';
import { AccountingService } from './accounting.service';

@ApiTags('accounting')
@ApiBearerAuth()
@Controller({ path: 'accounting', version: '1' })
export class AccountingController {
  constructor(private readonly service: AccountingService) {}

  @Get('ledger')
  @ApiOperation({ summary: 'Income statement for a month (YYYY-MM)' })
  ledger(@Query('month', new DefaultValuePipe(dhakaDateString().slice(0, 7))) month: string) {
    return this.service.ledger(month);
  }

  @Get('van-profitability')
  vanProfitability(@Query('month', new DefaultValuePipe(dhakaDateString().slice(0, 7))) month: string) {
    return this.service.vanProfitability(month);
  }
}
