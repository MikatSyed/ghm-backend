import { Module } from '@nestjs/common';
import { StockEntriesController } from './stock-entries.controller';
import { StockEntriesService } from './stock-entries.service';

@Module({
  controllers: [StockEntriesController],
  providers: [StockEntriesService],
  exports: [StockEntriesService],
})
export class StockEntriesModule {}
