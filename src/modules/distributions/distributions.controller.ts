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
import { DistributionsService } from './distributions.service';
import { AddDistributionLineDto } from './dto/add-line.dto';
import { CreateDistributionDto } from './dto/create-distribution.dto';
import { ListDistributionsQueryDto } from './dto/list-distributions.query';
import { UpdateDistributionLineDto } from './dto/update-line.dto';

@ApiTags('distributions')
@ApiBearerAuth()
@Controller({ path: 'distributions', version: '1' })
export class DistributionsController {
  constructor(private readonly service: DistributionsService) {}

  @Get()
  @ApiOperation({ summary: 'List distributions (filter by vanId, dateFrom, dateTo)' })
  list(@Query() q: ListDistributionsQueryDto) {
    return this.service.findAll(q);
  }

  @Post()
  @ApiOperation({ summary: 'Create allocation; decrements product stock atomically' })
  create(@Body() dto: CreateDistributionDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get distribution by id with lines' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete whole distribution; reverses warehouse stock' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }

  @Post(':id/lines')
  @ApiOperation({ summary: 'Add a new product line to an existing distribution' })
  addLine(@Param('id') id: string, @Body() dto: AddDistributionLineDto) {
    return this.service.addLine(id, dto);
  }

  @Patch(':id/lines/:lineId')
  @ApiOperation({ summary: 'Edit an allocated quantity' })
  patchLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateDistributionLineDto,
  ) {
    return this.service.updateLine(id, lineId, dto);
  }

  @Delete(':id/lines/:lineId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeLine(@Param('id') id: string, @Param('lineId') lineId: string): Promise<void> {
    await this.service.removeLine(id, lineId);
  }
}
