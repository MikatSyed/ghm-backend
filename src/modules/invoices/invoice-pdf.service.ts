import { Injectable } from '@nestjs/common';
import { Customer, Invoice, InvoiceItem, Van } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { Readable } from 'stream';
import { CompanyInfo, companyInfo } from './company-info';

type InvoiceWithRelations = Invoice & {
  van: Van | null;
  customer: Customer | null;
  items: (InvoiceItem & { product: { unit: string } })[];
  sale: { id: string } | null;
};

const INK = '#111827';
const MUTED = '#4b5563';
const RULE = '#1f2937';
const SOFT_RULE = '#d1d5db';

const MARGIN = 40;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_RESERVE = 40;

const COLS = {
  desc: { x: MARGIN, width: 280 },
  qty: { x: MARGIN + 280, width: 80 },
  rate: { x: MARGIN + 360, width: 85 },
  amount: { x: MARGIN + 445, width: CONTENT_WIDTH - 445 },
};

// PDFKit's standard 14 fonts (Helvetica/Times) only support WinAnsi encoding —
// the Bengali ৳ glyph renders as mojibake without embedding a Unicode font.
// "Tk" is the standard ASCII-safe abbreviation for Bangladeshi Taka.
function money(n: number): string {
  return `Tk ${Math.round(n).toLocaleString('en-US')}`;
}

// Borderless minimal layout modelled on a classic tax-invoice template: big
// company name + right-aligned address, plain label/value meta rows, an
// underlined items table (no per-row rules, no boxes), and a ruled totals
// block. Deliberately has no signature block — this is the real,
// post-confirmation Invoice, distinct from the pre-confirmation Order Slip.
@Injectable()
export class InvoicePdfService {
  render(invoice: InvoiceWithRelations): Readable {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });

    let y = this.drawLetterhead(doc, companyInfo);
    y = this.drawMeta(doc, invoice, y);
    y = this.drawItemsTable(doc, invoice, y);
    this.drawTotals(doc, invoice, companyInfo, y);
    this.stampFooterOnAllPages(doc, invoice, companyInfo);

    doc.end();
    return doc as unknown as Readable;
  }

  private drawLetterhead(doc: PDFKit.PDFDocument, company: CompanyInfo): number {
    const top = MARGIN;
    const rightX = MARGIN + 300;
    const rightWidth = CONTENT_WIDTH - 300;

    doc
      .font('Times-Bold')
      .fontSize(20)
      .fillColor(INK)
      .text(company.name, MARGIN, top, { width: 280 });

    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    let rightY = top;
    for (const line of company.addressLines) {
      doc.text(line, rightX, rightY, { width: rightWidth, align: 'right' });
      rightY = doc.y;
    }
    doc.text(`Phone ${company.phone}`, rightX, rightY, { width: rightWidth, align: 'right' });
    rightY = doc.y;
    doc.text(company.email, rightX, rightY, { width: rightWidth, align: 'right' });
    rightY = doc.y;

    const titleY = Math.max(doc.y, top + 40) + 24;
    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(INK)
      .text('Tax Invoice', MARGIN, titleY, { width: CONTENT_WIDTH });

    return doc.y + 16;
  }

  private drawMeta(doc: PDFKit.PDFDocument, invoice: InvoiceWithRelations, y: number): number {
    const leftWidth = CONTENT_WIDTH - 200;
    const rightX = MARGIN + CONTENT_WIDTH - 200;
    const rightWidth = 200;

    let leftY = y;
    const billedToName = invoice.customer?.name ?? invoice.van?.vanName ?? '-';
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor(INK)
      .text(billedToName, MARGIN, leftY, { width: leftWidth });
    leftY = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    if (invoice.customer) {
      const contactLine = [invoice.customer.phone, invoice.customer.address]
        .filter(Boolean)
        .join(' · ');
      if (contactLine) {
        doc.text(contactLine, MARGIN, leftY, { width: leftWidth });
        leftY = doc.y;
      }
    } else if (invoice.van?.driver) {
      doc.text(`Driver: ${invoice.van.driver}`, MARGIN, leftY, { width: leftWidth });
      leftY = doc.y;
    }

    const fields: [string, string][] = [
      ['Date', invoice.date.toISOString().slice(0, 10)],
      ['Invoice Number', invoice.id],
      ...(invoice.sale?.id ? ([['Sale Ref', invoice.sale.id]] as [string, string][]) : []),
      ['Status', invoice.status.toUpperCase()],
      ...(invoice.paidAt
        ? ([['Paid Date', invoice.paidAt.toISOString().slice(0, 10)]] as [string, string][])
        : []),
    ];
    let rightY = y;
    for (const [label, value] of fields) {
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor(INK)
        .text(label, rightX, rightY, { width: rightWidth * 0.55 });
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor(INK)
        .text(value, rightX + rightWidth * 0.55, rightY, {
          width: rightWidth * 0.45,
          align: 'right',
        });
      rightY += 13;
    }

    return Math.max(leftY, rightY) + 20;
  }

  private drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK);
    doc.text('DESCRIPTION', COLS.desc.x, y, { width: COLS.desc.width });
    doc.text('QUANTITY', COLS.qty.x, y, { width: COLS.qty.width, align: 'right' });
    doc.text('UNIT PRICE', COLS.rate.x, y, { width: COLS.rate.width, align: 'right' });
    doc.text('AMOUNT', COLS.amount.x, y, { width: COLS.amount.width, align: 'right' });
    const ruleY = y + 13;
    doc
      .lineWidth(1.2)
      .strokeColor(RULE)
      .moveTo(MARGIN, ruleY)
      .lineTo(MARGIN + CONTENT_WIDTH, ruleY)
      .stroke();
    return ruleY + 6;
  }

  private drawItemsTable(
    doc: PDFKit.PDFDocument,
    invoice: InvoiceWithRelations,
    startY: number,
  ): number {
    let y = this.drawTableHeader(doc, startY);
    const rowHeight = 16;
    const bottomLimit = PAGE_HEIGHT - MARGIN - FOOTER_RESERVE;

    invoice.items.forEach((item) => {
      if (y + rowHeight > bottomLimit) {
        doc.addPage();
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(MUTED)
          .text(`Invoice ${invoice.id} — continued`, MARGIN, MARGIN, { width: CONTENT_WIDTH });
        y = this.drawTableHeader(doc, MARGIN + 16);
      }
      doc.font('Helvetica').fontSize(9).fillColor(INK);
      doc.text(item.name, COLS.desc.x, y, { width: COLS.desc.width });
      doc.text(String(item.qty), COLS.qty.x, y, { width: COLS.qty.width, align: 'right' });
      doc.text(money(item.price), COLS.rate.x, y, { width: COLS.rate.width, align: 'right' });
      doc.text(money(item.subtotal), COLS.amount.x, y, {
        width: COLS.amount.width,
        align: 'right',
      });

      y += rowHeight;
    });

    return y + 12;
  }

  private drawTotals(
    doc: PDFKit.PDFDocument,
    invoice: InvoiceWithRelations,
    company: CompanyInfo,
    y: number,
  ): void {
    const blockHeight = 70;
    if (y + blockHeight > PAGE_HEIGHT - MARGIN - FOOTER_RESERVE) {
      doc.addPage();
      y = MARGIN;
    }

    const subtotal = invoice.items.reduce((sum, item) => sum + item.subtotal, 0);
    const vatAmount = company.vatRatePercent > 0 ? subtotal * (company.vatRatePercent / 100) : 0;
    const grandTotal = Math.round(subtotal + vatAmount);

    const totalsWidth = 200;
    const totalsX = MARGIN + CONTENT_WIDTH - totalsWidth;
    const rows: [string, string, boolean][] = [
      ['Subtotal', money(subtotal), false],
      ...(company.vatRatePercent > 0
        ? ([['VAT (' + company.vatRatePercent + '%)', money(vatAmount), false]] as [
            string,
            string,
            boolean,
          ][])
        : []),
      ['Total', money(grandTotal), true],
    ];
    let rowY = y;
    rows.forEach(([label, value, isGrand]) => {
      doc
        .lineWidth(isGrand ? 1.3 : 0.75)
        .strokeColor(isGrand ? RULE : SOFT_RULE)
        .moveTo(totalsX, rowY)
        .lineTo(totalsX + totalsWidth, rowY)
        .stroke();
      const textY = rowY + (isGrand ? 6 : 4);
      doc
        .font(isGrand ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(isGrand ? 12 : 9)
        .fillColor(INK)
        .text(label, totalsX, textY, { width: totalsWidth * 0.5 });
      doc
        .font('Helvetica-Bold')
        .fontSize(isGrand ? 12 : 9)
        .fillColor(INK)
        .text(value, totalsX + totalsWidth * 0.5, textY, {
          width: totalsWidth * 0.5,
          align: 'right',
        });
      rowY += isGrand ? 22 : 16;
    });
  }

  private stampFooterOnAllPages(
    doc: PDFKit.PDFDocument,
    invoice: InvoiceWithRelations,
    company: CompanyInfo,
  ): void {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footerY = PAGE_HEIGHT - MARGIN - 20;
      const noteWidth = CONTENT_WIDTH * 0.65;
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(company.footerNote ?? '', MARGIN, footerY, { width: noteWidth });
      if (invoice.status !== 'paid') {
        doc
          .font('Helvetica-Bold')
          .fontSize(8.5)
          .fillColor(INK)
          .text('Due on receipt', MARGIN + noteWidth, footerY, {
            width: CONTENT_WIDTH - noteWidth,
            align: 'right',
          });
      }
    }
  }
}
