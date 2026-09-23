import { Global, Module } from '@nestjs/common';
import { PrefixIdService } from './services/prefix-id.service';
import { StockLotService } from './services/stock-lot.service';
import { PricingService } from './services/pricing.service';

@Global()
@Module({
  providers: [PrefixIdService, StockLotService, PricingService],
  exports: [PrefixIdService, StockLotService, PricingService],
})
export class CommonModule {}
