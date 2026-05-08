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
import { PurchasesService } from './purchases.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { ListPurchasesQueryDto } from './dto/list-purchases.query';

@ApiTags('purchases')
@ApiBearerAuth()
@Controller({ path: 'purchases', version: '1' })
export class PurchasesController {
  constructor(private readonly service: PurchasesService) {}

  @Get()
  @ApiOperation({ summary: 'List all purchases with optional filters' })
  list(@Query() q: ListPurchasesQueryDto) {
    return this.service.findAll(q);
  }

  @Post()
  @ApiOperation({ summary: 'Create a purchase — calculates effective buy price from costs' })
  create(@Body() dto: CreatePurchaseDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get purchase by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a purchase and recalculate product buy/sell price' })
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a purchase' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }
}
