import { Controller, Get, Header, Param, Patch, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Body } from '@nestjs/common';
import { ListInvoicesQueryDto } from './dto/list-invoices.query';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesService } from './invoices.service';

@ApiTags('invoices')
@ApiBearerAuth()
@Controller({ path: 'invoices', version: '1' })
export class InvoicesController {
  constructor(
    private readonly service: InvoicesService,
    private readonly pdf: InvoicePdfService,
  ) {}

  @Get()
  list(@Query() q: ListInvoicesQueryDto) {
    return this.service.findAll(q);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="invoices.csv"')
  async export(@Query() q: ListInvoicesQueryDto): Promise<string> {
    return this.service.exportCsv(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update invoice (e.g. mark paid). Paid → cannot revert.' })
  patch(@Param('id') id: string, @Body() dto: UpdateInvoiceDto) {
    return this.service.update(id, dto);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download invoice as PDF' })
  async getPdf(@Param('id') id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const inv = await this.service.findOne(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${inv.id}.pdf"`);
    return new StreamableFile(this.pdf.render(inv));
  }
}
