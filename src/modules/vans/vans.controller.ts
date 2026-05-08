import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateVanDto } from './dto/create-van.dto';
import { UpdateVanDto } from './dto/update-van.dto';
import { VansService } from './vans.service';

@ApiTags('vans')
@ApiBearerAuth()
@Controller({ path: 'vans', version: '1' })
export class VansController {
  constructor(private readonly service: VansService) {}

  @Get()
  @ApiOperation({ summary: 'List vans with today summary' })
  list() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateVanDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update vanName or driver' })
  update(@Param('id') id: string, @Body() dto: UpdateVanDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete van; blocked if van still holds undelivered stock' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }

  @Get(':id/distribution')
  @ApiOperation({ summary: 'Current allocation for a date (default: today)' })
  distribution(@Param('id') id: string, @Query('date') date?: string) {
    return this.service.distributionForDate(id, date);
  }

  @Get(':id/stock-summary')
  @ApiOperation({
    summary:
      'Per-product van stock summary for a date: allocated/returned/sold/damaged/available + reconciliation status',
  })
  stockSummary(@Param('id') id: string, @Query('date') date?: string) {
    return this.service.stockSummary(id, date);
  }

  @Get(':id/activity')
  @ApiOperation({
    summary:
      'Chronological activity log for van+date: allocations, sales, returns, damage/wastage/corrections',
  })
  activity(@Param('id') id: string, @Query('date') date?: string) {
    return this.service.activity(id, date);
  }
}
