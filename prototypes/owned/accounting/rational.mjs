// Tiny exact rational arithmetic for a SYNTHETIC ACCOUNTING ORACLE.
// This is deliberately not a production tax / monetary library.
const gcd = (a, b) => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};
export class Q {
  constructor(n, d = 1n) {
    if (d === 0n) throw new Error('Zero denominator');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d);
    this.n = n / g;
    this.d = d / g;
    Object.freeze(this);
  }
  static of(value) {
    if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(value)) {
      throw new Error('Amounts must be finite decimal strings with at most 12 fractional digits');
    }
    const negative = value.startsWith('-');
    const parts = (negative ? value.slice(1) : value).split('.');
    const power = 10n ** BigInt((parts[1] ?? '').length);
    const numerator = BigInt(parts[0]) * power + BigInt(parts[1] || '0');
    return new Q(negative ? -numerator : numerator, power);
  }
  static zero() { return new Q(0n); }
  add(b) { return new Q(this.n * b.d + b.n * this.d, this.d * b.d); }
  sub(b) { return new Q(this.n * b.d - b.n * this.d, this.d * b.d); }
  mul(b) { return new Q(this.n * b.n, this.d * b.d); }
  div(b) { return new Q(this.n * b.d, this.d * b.n); }
  cmp(b) { const v = this.n * b.d - b.n * this.d; return v < 0n ? -1 : v > 0n ? 1 : 0; }
  fixed(places = 2) {
    if (!Number.isSafeInteger(places) || places < 0 || places > 12) throw new Error('Invalid precision');
    const scale = 10n ** BigInt(places);
    const negative = this.n < 0n;
    const abs = negative ? -this.n : this.n;
    // Half away from zero FOR DISPLAY ONLY: retain exact fractions internally.
    const rounded = (2n * abs * scale + this.d) / (2n * this.d);
    const whole = rounded / scale;
    const decimal = places ? '.' + (rounded % scale).toString().padStart(places, '0') : '';
    return (negative && rounded !== 0n ? '-' : '') + whole + decimal;
  }
}
