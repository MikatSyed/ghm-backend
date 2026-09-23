import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfirmDistributionOrderDto } from './dto/confirm-distribution-order.dto';
import { CreateDistributionOrderDto } from './dto/create-distribution-order.dto';
import { ListDistributionOrdersQueryDto } from './dto/list-distribution-orders.query';
import { DistributionOrdersService } from './distribution-orders.service';

@ApiTags('distribution-orders')
@ApiBearerAuth()
@Controller({ path: 'distribution-orders', version: '1' })
export class DistributionOrdersController {
  constructor(private readonly service: DistributionOrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List restaurant/shop distribution orders' })
  list(@Query() q: ListDistributionOrdersQueryDto) {
    return this.service.findAll(q);
  }

  @Post()
  @ApiOperation({
    summary: 'Issue a distribution order to a customer. Does not move stock.',
  })
  create(@Body() dto: CreateDistributionOrderDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/confirm')
  @ApiOperation({
    summary:
      'Confirm delivered quantities: creates a Sale + Invoice and consumes warehouse stock for the confirmed quantities only.',
  })
  confirm(@Param('id') id: string, @Body() dto: ConfirmDistributionOrderDto) {
    return this.service.confirm(id, dto);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an issued (not yet confirmed) distribution order' })
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }
}
