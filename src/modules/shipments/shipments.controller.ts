import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ShipmentsService } from './shipments.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';

@ApiTags('Shipments')
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new shipment (truck) with multiple products' })
  async create(@Body() dto: CreateShipmentDto) {
    return this.shipmentsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all shipments' })
  async findAll() {
    return this.shipmentsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get shipment details' })
  async findOne(@Param('id') id: string) {
    return this.shipmentsService.findOne(id);
  }
}
