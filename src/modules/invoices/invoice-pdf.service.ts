import { Injectable } from '@nestjs/common';
import { Invoice, InvoiceItem, Van } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { Readable } from 'stream';

type InvoiceWithRelations = Invoice & { van: Van; items: InvoiceItem[] };

@Injectable()
export class InvoicePdfService {
  render(invoice: InvoiceWithRelations): Readable {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });

    doc.fontSize(20).text('GHM Distribution', { align: 'left' });
    doc.fontSize(10).fillColor('gray').text('Fresh produce — Asia/Dhaka', { align: 'left' });
    doc.moveDown();

    doc.fillColor('black').fontSize(14).text(`Invoice ${invoice.id}`);
    doc.fontSize(10).fillColor('gray').text(`Date: ${invoice.date.toISOString().slice(0, 10)}`);
    doc.text(`Van:  ${invoice.van.vanName} (${invoice.vanId})`);
    doc.text(`Status: ${invoice.status.toUpperCase()}`);
    doc.moveDown();

    const top = doc.y;
    const colX = { item: 48, qty: 320, price: 380, sub: 470 };
    doc.fillColor('black').fontSize(11);
    doc.text('Item', colX.item, top);
    doc.text('Qty', colX.qty, top, { width: 50, align: 'right' });
    doc.text('Price', colX.price, top, { width: 80, align: 'right' });
    doc.text('Subtotal', colX.sub, top, { width: 80, align: 'right' });
    doc.moveTo(48, top + 16).lineTo(550, top + 16).stroke();

    let y = top + 22;
    for (const it of invoice.items) {
      doc.text(it.name, colX.item, y, { width: 260 });
      doc.text(String(it.qty), colX.qty, y, { width: 50, align: 'right' });
      doc.text(`৳${it.price.toLocaleString()}`, colX.price, y, { width: 80, align: 'right' });
      doc.text(`৳${it.subtotal.toLocaleString()}`, colX.sub, y, { width: 80, align: 'right' });
      y += 18;
    }

    doc.moveTo(48, y + 4).lineTo(550, y + 4).stroke();
    doc.fontSize(13).text(`Total: ৳${invoice.total.toLocaleString()}`, 48, y + 14, { align: 'right' });

    doc.end();
    return doc as unknown as Readable;
  }
}
