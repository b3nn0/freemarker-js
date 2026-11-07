// Exact-decimal arithmetic engine <- ArithmeticEngine.BigDecimalEngine (2.3.36
// default): numbers carry a BigInt unscaled value + scale; division is exact
// with minScale 12 HALF_UP; multiplication caps scale at 100; comparisons are
// exact. Formatting (?c, default number_format) follows BigDecimal.toString.

const DIV_MIN_SCALE = 12; // <- ArithmeticEngine.setMinScale default
const MUL_MAX_SCALE = 100; // <- ArithmeticEngine.setMaxScale default

export class Decimal {
  /** @param {bigint} unscaled @param {number} scale */
  constructor(unscaled, scale) {
    this.u = unscaled;
    this.s = scale;
  }

  /**
   * Exact parse of a template number-literal image ("123", "1.5").
   * @param {string} image @returns {Decimal}
   */
  static fromLiteral(image) {
    return Decimal.parse(image);
  }

  /**
   * BigDecimal.valueOf(double)-style: shortest decimal repr of a JS number.
   * @param {number} n @returns {Decimal}
   */
  static fromNumber(n) {
    if (!Number.isFinite(n)) throw new TypeError('non-finite number');
    return Decimal.parse(String(n));
  }

  /** @param {string} s - decimal with optional sign and e/E exponent @returns {Decimal} */
  static parse(s) {
    let str = s.trim();
    let sign = 1n;
    if (str[0] === '+' || str[0] === '-') {
      if (str[0] === '-') sign = -1n;
      str = str.slice(1);
    }
    let scale = 0;
    const e = str.search(/[eE]/);
    if (e !== -1) {
      scale = -parseInt(str.slice(e + 1), 10);
      str = str.slice(0, e);
    }
    const dot = str.indexOf('.');
    let digits = str;
    if (dot !== -1) {
      scale -= str.length - dot - 1;
      digits = str.slice(0, dot) + str.slice(dot + 1);
    }
    if (!/^\d+$/.test(digits)) throw new TypeError(`bad decimal literal: ${s}`);
    return new Decimal(sign * BigInt(digits), -scale);
  }

  /** @returns {number} */
  toNumber() {
    return Number(this.toString());
  }

  /** @returns {number} -1 | 0 | 1 */
  signum() {
    return this.u === 0n ? 0 : this.u < 0n ? -1 : 1;
  }

  /** @param {Decimal} o @returns {Decimal} */
  add(o) {
    const s = Math.max(this.s, o.s);
    return new Decimal(this.u * pow10(s - this.s) + o.u * pow10(s - o.s), s);
  }

  /** @returns {Decimal} */
  neg() {
    return new Decimal(-this.u, this.s);
  }

  /** @param {Decimal} o @returns {Decimal} */
  sub(o) {
    return this.add(o.neg());
  }

  /** @param {Decimal} o @returns {Decimal} - scale capped at MUL_MAX_SCALE */
  mul(o) {
    let r = new Decimal(this.u * o.u, this.s + o.s);
    if (r.s > MUL_MAX_SCALE) r = r.setScale(MUL_MAX_SCALE);
    return r;
  }

  /**
   * @param {Decimal} o @returns {Decimal} - scale = max(s1, s2, DIV_MIN_SCALE), HALF_UP
   */
  div(o) {
    if (o.u === 0n) throw new Error('Division by zero.');
    const scale = Math.max(this.s, o.s, DIV_MIN_SCALE);
    const neg = (this.u < 0n) !== (o.u < 0n);
    let a = this.u < 0n ? -this.u : this.u;
    let b = o.u < 0n ? -o.u : o.u;
    const e = scale + o.s - this.s;
    if (e >= 0) a = a * pow10(e); else b = b * pow10(-e);
    let q = a / b;
    if ((a % b) * 2n >= b) q += 1n; // <- ROUND_HALF_UP (ties away from zero)
    return new Decimal(neg ? -q : q, scale);
  }

  /**
   * Truncated-integer remainder <- BigDecimalEngine.modulus (longValue % longValue).
   * @param {Decimal} o @returns {Decimal}
   */
  modulus(o) {
    const a = this.trunc(), b = o.trunc();
    return new Decimal(a.u % b.u, 0);
  }

  /** @returns {Decimal} - toward zero, integer */
  trunc() {
    if (this.s <= 0) return new Decimal(this.u, 0);
    const p = pow10(this.s);
    return new Decimal(this.u / p, 0);
  }

  /**
   * @param {number} t @returns {Decimal} - ROUND_HALF_UP (ties away from zero)
   */
  setScale(t) {
    if (t === this.s) return this;
    if (t > this.s) return new Decimal(this.u * pow10(t - this.s), t);
    const neg = this.u < 0n;
    let a = neg ? -this.u : this.u;
    const p = pow10(this.s - t);
    let q = a / p;
    if ((a % p) * 2n >= p) q += 1n;
    return new Decimal(neg ? -q : q, t);
  }

  /** @param {Decimal} o @returns {number} -1 | 0 | 1 (exact) */
  cmp(o) {
    const s = Math.max(this.s, o.s);
    const a = this.u * pow10(s - this.s);
    const b = o.u * pow10(s - o.s);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /**
   * Fraction zeros removed down to scale 0 (never negative) <- the ?c path's
   * BigDecimal.toString() is applied after this strip; e.g. "1.10" -> 1.1,
   * "1000...0" (scale 0) stays a plain integer, "0.0000001" keeps scale 7.
   * @returns {Decimal}
   */
  stripFractionZeros() {
    if (this.u === 0n) return new Decimal(0n, 0);
    let u = this.u, s = this.s;
    while (s > 0 && u % 10n === 0n) {
      u /= 10n;
      s -= 1;
    }
    return new Decimal(u, s);
  }

  /** @returns {string} plain decimal notation (never exponential) */
  toPlainString() {
    const neg = this.u < 0n;
    const digits = (neg ? -this.u : this.u).toString();
    let out;
    if (this.s <= 0) {
      out = digits + '0'.repeat(-this.s);
    } else if (digits.length > this.s) {
      out = digits.slice(0, digits.length - this.s) + '.' + digits.slice(digits.length - this.s);
    } else {
      out = '0.' + '0'.repeat(this.s - digits.length) + digits;
    }
    return (neg ? '-' : '') + out;
  }

  /** @returns {string} BigDecimal.toString()-style (exponential when needed) */
  toJavaString() {
    const d = this.stripFractionZeros();
    const neg = d.u < 0n;
    const digits = (neg ? -d.u : d.u).toString();
    const adj = digits.length - d.s - 1; // adjusted exponent
    if (adj >= -6) return d.toPlainString();
    const mantissa = digits.length === 1 ? digits : digits[0] + '.' + digits.slice(1);
    const exp = adj < 0 ? `-${-adj}` : `+${adj}`;
    return `${neg ? '-' : ''}${mantissa}E${exp}`;
  }

  /** @returns {string} */
  toString() {
    return this.toPlainString();
  }
}

/**
 * @param {number} n @returns {bigint} 10^n
 */
function pow10(n) {
  return 10n ** BigInt(n);
}
