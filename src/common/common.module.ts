import { Global, Module } from '@nestjs/common';
import { PrefixIdService } from './services/prefix-id.service';
import { StockLotService } from './services/stock-lot.service';

@Global()
@Module({
  providers: [PrefixIdService, StockLotService],
  exports: [PrefixIdService, StockLotService],
})
export class CommonModule {}
