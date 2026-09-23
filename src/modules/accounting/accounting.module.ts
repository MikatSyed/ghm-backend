import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { BatchVanProfitabilityService } from './batch-van-profitability.service';
import { BatchProfitabilityService } from './batch-profitability.service';

@Module({
  controllers: [AccountingController],
  providers: [AccountingService, BatchProfitabilityService, BatchVanProfitabilityService],
})
export class AccountingModule {}
