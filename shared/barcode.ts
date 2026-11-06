// Utilitas barcode EAN-13, termasuk barcode timbangan (in-store, prefix GS1 20–29).

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

export function makeEan13(first12: string): string {
  return first12 + ean13CheckDigit(first12);
}

/**
 * Barcode label timbangan: `2F PPPPP WWWWW C`
 *  - 2F    : prefix in-store (20–29)
 *  - PPPPP : kode PLU 5 digit
 *  - WWWWW : berat dalam gram
 *  - C     : check digit EAN-13
 */
export function parseScaleBarcode(code: string): { plu: string; weightKg: number } | null {
  if (!isValidEan13(code) || code[0] !== '2') return null;
  const plu = code.slice(2, 7);
  const grams = Number(code.slice(7, 12));
  if (grams <= 0) return null;
  return { plu, weightKg: grams / 1000 };
}

export function makeScaleBarcode(plu: string, weightKg: number): string {
  const grams = String(Math.round(weightKg * 1000)).padStart(5, '0');
  return makeEan13(`20${plu.padStart(5, '0')}${grams}`);
}
