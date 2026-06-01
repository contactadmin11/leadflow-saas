const PDFDocument = require('pdfkit');
const { stateFromGSTIN } = require('./gst.service');

/**
 * Generate a professional GST Invoice PDF.
 * Returns a Buffer containing the PDF bytes.
 * @param {object} invoice - Invoice document from DB
 * @param {object} settings - User/business settings
 */
const generateInvoicePDF = (invoice, settings) => {
  return new Promise((resolve, reject) => {
    try {
      const buffers = [];
      const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const currency = settings.currency || '₹';
      const bizName  = settings.bizName || 'Your Business';
      const BLUE     = '#1e3a8a';
      const LIGHT    = '#f0f4f8';

      // ── Header ─────────────────────────────────────────────────────────
      doc.rect(40, 40, 515, 70).fill(BLUE);
      doc.fontSize(20).fillColor('#ffffff').font('Helvetica-Bold')
         .text(bizName, 55, 55, { width: 300 });
      doc.fontSize(9).fillColor('#93c5fd').font('Helvetica')
         .text([settings.address, settings.phone, settings.email].filter(Boolean).join('  |  '), 55, 80, { width: 300 });

      // Invoice label
      doc.fillColor('#ffffff').fontSize(14).font('Helvetica-Bold')
         .text('TAX INVOICE', 430, 55, { align: 'right', width: 120 });
      doc.fontSize(9).font('Helvetica')
         .text(`#${invoice.invoiceNo}`, 430, 75, { align: 'right', width: 120 });

      // ── Seller & Buyer info ────────────────────────────────────────────
      const infoY = 125;
      doc.rect(40, infoY, 250, 90).fill(LIGHT);
      doc.rect(300, infoY, 255, 90).fill(LIGHT);

      doc.fillColor(BLUE).fontSize(8).font('Helvetica-Bold')
         .text('FROM (SELLER)', 50, infoY + 8)
         .fillColor('#0f172a').font('Helvetica').fontSize(9)
         .text(bizName, 50, infoY + 20)
         .fillColor('#475569').fontSize(8)
         .text(settings.gstin ? `GSTIN: ${settings.gstin}` : '', 50, infoY + 34)
         .text(settings.state || '', 50, infoY + 46)
         .text(settings.pan ? `PAN: ${settings.pan}` : '', 50, infoY + 58);

      doc.fillColor(BLUE).fontSize(8).font('Helvetica-Bold')
         .text('TO (BUYER)', 310, infoY + 8)
         .fillColor('#0f172a').font('Helvetica').fontSize(9)
         .text(invoice.clientName || '—', 310, infoY + 20)
         .fillColor('#475569').fontSize(8)
         .text(invoice.clientGstin ? `GSTIN: ${invoice.clientGstin}` : '', 310, infoY + 34)
         .text(invoice.clientState || invoice.buyerState || '', 310, infoY + 46)
         .text(invoice.clientAddress ? invoice.clientAddress.substring(0, 60) : '', 310, infoY + 58);

      // ── Invoice meta ───────────────────────────────────────────────────
      const metaY = 230;
      const meta = [
        ['Invoice No.',    invoice.invoiceNo],
        ['Invoice Date',   fmtDate(invoice.invoiceDate)],
        ['Due Date',       fmtDate(invoice.dueDate)],
        ['Payment Terms',  settings.payTerms ? `${settings.payTerms} days` : '—'],
        invoice.poReference ? ['PO Reference', invoice.poReference] : null
      ].filter(Boolean);

      let mx = 40;
      meta.forEach(([k, v]) => {
        doc.rect(mx, metaY, 103, 30).fill(LIGHT).stroke('#e2e8f0');
        doc.fillColor('#475569').fontSize(7).font('Helvetica-Bold')
           .text(k.toUpperCase(), mx + 5, metaY + 5);
        doc.fillColor('#0f172a').fontSize(9).font('Helvetica')
           .text(v || '—', mx + 5, metaY + 16);
        mx += 103;
      });

      // ── Line items table ───────────────────────────────────────────────
      const tableY = 275;
      const cols   = [30, 200, 60, 65, 45, 65, 65, 70];
      const hdrs   = ['#', 'DESCRIPTION', 'SAC', 'QTY', 'GST%', 'RATE', 'GST AMT', 'TOTAL'];

      // Header row
      doc.rect(40, tableY, 515, 22).fill(BLUE);
      let cx = 40;
      hdrs.forEach((h, i) => {
        doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold')
           .text(h, cx + 3, tableY + 7, { width: cols[i] - 6, align: i > 1 ? 'right' : 'left' });
        cx += cols[i];
      });

      let rowY = tableY + 22;
      (invoice.items || []).forEach((item, idx) => {
        const bg = idx % 2 === 0 ? '#ffffff' : LIGHT;
        doc.rect(40, rowY, 515, 20).fill(bg);
        cx = 40;
        const cells = [
          String(idx + 1),
          item.name || '',
          item.sac || '',
          String(item.qty),
          `${item.gstRate}%`,
          `${currency}${fmtNum(item.rate)}`,
          `${currency}${fmtNum(item.gstAmount)}`,
          `${currency}${fmtNum(item.total)}`
        ];
        cells.forEach((cell, i) => {
          doc.fillColor('#0f172a').fontSize(8).font('Helvetica')
             .text(cell, cx + 3, rowY + 5, {
               width: cols[i] - 6,
               align: i > 1 ? 'right' : 'left',
               ellipsis: true
             });
          cx += cols[i];
        });
        rowY += 20;
      });

      doc.rect(40, rowY, 515, 1).fill('#e2e8f0');

      // ── Totals ─────────────────────────────────────────────────────────
      const totY = rowY + 12;
      const totWidth = 200;
      const totX = 555 - totWidth;
      const totLines = [
        ['Subtotal',  `${currency}${fmtNum(invoice.subtotal)}`],
        ...(invoice.cgst ? [['CGST', `${currency}${fmtNum(invoice.cgst)}`]] : []),
        ...(invoice.sgst ? [['SGST', `${currency}${fmtNum(invoice.sgst)}`]] : []),
        ...(invoice.igst ? [['IGST', `${currency}${fmtNum(invoice.igst)}`]] : []),
        invoice.paidAmount ? ['Paid Amount', `-${currency}${fmtNum(invoice.paidAmount)}`] : null,
      ].filter(Boolean);

      let ty = totY;
      totLines.forEach(([k, v]) => {
        doc.fillColor('#475569').fontSize(9).font('Helvetica')
           .text(k, totX, ty, { width: totWidth - 70, align: 'right' })
           .fillColor('#0f172a')
           .text(v, totX + totWidth - 70, ty, { width: 65, align: 'right' });
        ty += 16;
      });

      // Grand total
      const balance = (invoice.total || 0) - (invoice.paidAmount || 0);
      doc.rect(totX - 5, ty, totWidth + 5, 24).fill(BLUE);
      doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
         .text('BALANCE DUE', totX, ty + 6, { width: totWidth - 70, align: 'right' })
         .text(`${currency}${fmtNum(balance)}`, totX + totWidth - 70, ty + 6, { width: 65, align: 'right' });

      ty += 30;

      // ── Notes ──────────────────────────────────────────────────────────
      if (invoice.notes || settings.upiId) {
        doc.rect(40, ty, 515, 1).fill('#e2e8f0');
        ty += 8;
        if (settings.upiId) {
          doc.fillColor(BLUE).fontSize(8).font('Helvetica-Bold')
             .text('Payment: ', 40, ty)
             .fillColor('#0f172a').font('Helvetica')
             .text(`UPI ID: ${settings.upiId}`, 90, ty);
          ty += 14;
        }
        if (invoice.notes) {
          doc.fillColor('#475569').fontSize(8).font('Helvetica')
             .text(invoice.notes, 40, ty, { width: 515 });
          ty += 14;
        }
      }

      // ── Footer ─────────────────────────────────────────────────────────
      doc.rect(40, 780, 515, 30).fill(BLUE);
      doc.fillColor('#93c5fd').fontSize(8).font('Helvetica')
         .text('Thank you for your business! Generated by LeadFlow CRM', 40, 792, { align: 'center', width: 515 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

/**
 * Generate a professional Quotation PDF.
 */
const generateQuotePDF = (quote, settings) => {
  return new Promise((resolve, reject) => {
    try {
      const buffers = [];
      const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const currency = settings.currency || '₹';
      const bizName  = settings.bizName  || 'Your Business';
      const BLUE     = '#1e3a8a';
      const LIGHT    = '#f0f4f8';

      // Header
      doc.rect(40, 40, 515, 70).fill(BLUE);
      doc.fontSize(20).fillColor('#ffffff').font('Helvetica-Bold')
         .text(bizName, 55, 55, { width: 300 });
      doc.fillColor('#ffffff').fontSize(14).font('Helvetica-Bold')
         .text('QUOTATION', 430, 55, { align: 'right', width: 120 });
      doc.fontSize(9).fillColor('#93c5fd').font('Helvetica')
         .text(`#${quote.quoteNo}`, 430, 75, { align: 'right', width: 120 });

      // Buyer info
      const infoY = 125;
      doc.rect(40, infoY, 515, 70).fill(LIGHT);
      doc.fillColor(BLUE).fontSize(8).font('Helvetica-Bold')
         .text('QUOTATION FOR:', 50, infoY + 8)
         .fillColor('#0f172a').fontSize(10).font('Helvetica-Bold')
         .text(quote.clientName || '—', 50, infoY + 22)
         .fillColor('#475569').fontSize(8).font('Helvetica')
         .text([quote.clientEmail, quote.clientPhone].filter(Boolean).join('  |  '), 50, infoY + 38)
         .text(quote.clientGstin ? `GSTIN: ${quote.clientGstin}` : '', 50, infoY + 52);

      // Meta
      doc.fillColor(BLUE).fontSize(8).font('Helvetica-Bold')
         .text('Quote No:', 350, infoY + 8)
         .text('Valid Till:', 350, infoY + 22)
         .text('Status:', 350, infoY + 36)
         .fillColor('#0f172a').font('Helvetica')
         .text(quote.quoteNo, 430, infoY + 8)
         .text(quote.validTill ? fmtDate(quote.validTill) : 'Open', 430, infoY + 22)
         .text(quote.status || 'Draft', 430, infoY + 36);

      // Items table
      const tableY = 210;
      const cols = [30, 220, 60, 65, 45, 65, 70];
      const hdrs = ['#', 'DESCRIPTION', 'SAC', 'QTY', 'GST%', 'RATE', 'TOTAL'];
      doc.rect(40, tableY, 515, 22).fill(BLUE);
      let cx = 40;
      hdrs.forEach((h, i) => {
        doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold')
           .text(h, cx + 3, tableY + 7, { width: cols[i] - 6, align: i > 1 ? 'right' : 'left' });
        cx += cols[i];
      });
      let rowY = tableY + 22;
      (quote.items || []).forEach((item, idx) => {
        doc.rect(40, rowY, 515, 20).fill(idx % 2 === 0 ? '#ffffff' : LIGHT);
        cx = 40;
        const cells = [
          String(idx + 1), item.name || '', item.sac || '',
          String(item.qty), `${item.gstRate}%`,
          `${currency}${fmtNum(item.rate)}`, `${currency}${fmtNum(item.total)}`
        ];
        cells.forEach((cell, i) => {
          doc.fillColor('#0f172a').fontSize(8).font('Helvetica')
             .text(cell, cx + 3, rowY + 5, { width: cols[i] - 6, align: i > 1 ? 'right' : 'left', ellipsis: true });
          cx += cols[i];
        });
        rowY += 20;
      });

      // Totals
      let ty = rowY + 12;
      const totX = 360;
      [
        ['Subtotal', `${currency}${fmtNum(quote.subtotal)}`],
        ...(quote.cgst ? [['CGST', `${currency}${fmtNum(quote.cgst)}`]] : []),
        ...(quote.sgst ? [['SGST', `${currency}${fmtNum(quote.sgst)}`]] : []),
        ...(quote.igst ? [['IGST', `${currency}${fmtNum(quote.igst)}`]] : [])
      ].forEach(([k, v]) => {
        doc.fillColor('#475569').fontSize(9).font('Helvetica')
           .text(k, totX, ty, { width: 110, align: 'right' })
           .fillColor('#0f172a')
           .text(v, totX + 110, ty, { width: 85, align: 'right' });
        ty += 16;
      });
      doc.rect(totX - 5, ty, 200, 24).fill(BLUE);
      doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
         .text('GRAND TOTAL', totX, ty + 6, { width: 110, align: 'right' })
         .text(`${currency}${fmtNum(quote.total)}`, totX + 110, ty + 6, { width: 85, align: 'right' });

      // Notes/terms
      if (quote.notes || quote.terms) {
        ty += 36;
        doc.rect(40, ty, 515, 1).fill('#e2e8f0');
        ty += 8;
        if (quote.terms) {
          doc.fillColor(BLUE).fontSize(8).font('Helvetica-Bold').text('Terms: ', 40, ty)
             .fillColor('#475569').font('Helvetica').text(quote.terms, 80, ty);
          ty += 14;
        }
        if (quote.notes) {
          doc.fillColor('#475569').fontSize(8).font('Helvetica')
             .text(quote.notes, 40, ty, { width: 515 });
        }
      }

      // Footer
      doc.rect(40, 780, 515, 30).fill(BLUE);
      doc.fillColor('#93c5fd').fontSize(8).font('Helvetica')
         .text('This is a computer-generated quotation. Generated by LeadFlow CRM', 40, 792, { align: 'center', width: 515 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

const fmtDate = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtNum = (n) => {
  return (parseFloat(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

module.exports = { generateInvoicePDF, generateQuotePDF };
