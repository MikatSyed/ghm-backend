import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';

type Timeframe = 'daily' | 'weekly' | 'monthly' | 'yearly';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Top dashboard metrics' })
  metrics() {
    return this.service.metrics();
  }

  @Get('series')
  series(@Query('timeframe', new DefaultValuePipe('weekly')) timeframe: Timeframe) {
    return this.service.series(timeframe);
  }

  @Get('vans/performance')
  vanPerformance() {
    return this.service.vanPerformance();
  }

  @Get('categories/breakdown')
  categoryBreakdown() {
    return this.service.categoryBreakdown();
  }

  @Get('alerts/low-stock')
  lowStock(@Query('threshold', new DefaultValuePipe(10), ParseIntPipe) threshold: number) {
    return this.service.lowStock(threshold);
  }

  @Get('activity')
  activity(@Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number) {
    return this.service.activity(limit);
  }
}
