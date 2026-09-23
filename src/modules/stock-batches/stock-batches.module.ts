import { Module } from '@nestjs/common';
import { StockBatchesController } from './stock-batches.controller';
import { StockBatchesService } from './stock-batches.service';

@Module({
  controllers: [StockBatchesController],
  providers: [StockBatchesService],
  exports: [StockBatchesService],
})
export class StockBatchesModule {}
