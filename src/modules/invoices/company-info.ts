export interface CompanyInfo {
  name: string;
  tagline?: string;
  addressLines: string[];
  phone: string;
  email: string;
  bin: string;
  tin?: string;
  vatRatePercent: number;
  footerNote?: string;
}

// Keep this in sync with the frontend's src/lib/company.ts — same fields,
// same values, so the printed browser receipt and the downloaded PDF match.
export const companyInfo: CompanyInfo = {
  name: 'Green Harvest Mark (GHM Fresh)',
  tagline: 'Fresh produce distribution and wholesale supply',
  addressLines: [
    'House / Road / Area, Dhaka, Bangladesh',
    'Replace this address from company settings before issuing tax invoices',
  ],
  phone: '+880 1XXX-XXXXXX',
  email: 'accounts@example.com',
  bin: 'BIN-TO-BE-UPDATED',
  tin: 'TIN-TO-BE-UPDATED',
  vatRatePercent: 0,
  footerNote:
    'Goods once received must be checked at delivery. VAT treatment follows the applicable Bangladesh VAT rules.',
};
