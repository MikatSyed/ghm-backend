import { Module } from '@nestjs/common';
import { DistributionOrdersController } from './distribution-orders.controller';
import { DistributionOrdersService } from './distribution-orders.service';

@Module({
  controllers: [DistributionOrdersController],
  providers: [DistributionOrdersService],
  exports: [DistributionOrdersService],
})
export class DistributionOrdersModule {}
