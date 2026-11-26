/** CN numbers are stored as 32-bit integers — anything bigger (a phone number,
 * a product barcode) is "not a CN", never a database crash. */
export const CN_MAX = 2147483647;
export function isCnInt(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0 && n <= CN_MAX;
}
