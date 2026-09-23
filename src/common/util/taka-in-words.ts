const BELOW_TWENTY = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
] as const;

function underHundred(n: number): string {
  if (n < 20) return BELOW_TWENTY[n];
  const ten = Math.floor(n / 10);
  const rest = n % 10;
  return rest ? `${TENS[ten]} ${BELOW_TWENTY[rest]}` : TENS[ten];
}

function underThousand(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundred) return underHundred(rest);
  return rest
    ? `${BELOW_TWENTY[hundred]} hundred ${underHundred(rest)}`
    : `${BELOW_TWENTY[hundred]} hundred`;
}

// Bangladeshi numbering (crore / lakh / thousand) — kept identical to the
// frontend's src/lib/taka-in-words.ts so printed and PDF invoices agree.
export function takaInWords(amount: number): string {
  const value = Math.max(0, Math.round(Number.isFinite(amount) ? amount : 0));
  if (value === 0) return 'Taka zero only';

  const parts: string[] = [];
  const crore = Math.floor(value / 10_000_000);
  const lakh = Math.floor((value % 10_000_000) / 100_000);
  const thousand = Math.floor((value % 100_000) / 1_000);
  const rest = value % 1_000;

  if (crore) parts.push(`${underThousand(crore)} crore`);
  if (lakh) parts.push(`${underThousand(lakh)} lakh`);
  if (thousand) parts.push(`${underThousand(thousand)} thousand`);
  if (rest) parts.push(underThousand(rest));

  return `Taka ${parts.join(' ')} only`.replace(/\s+/g, ' ');
}
