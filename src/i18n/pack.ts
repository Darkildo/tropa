// Translation files travel in main.js packed by locales.esbuild.mjs: the values only, in the order of
// the English keys, as JSON, compressed with raw DEFLATE and written as base64. This turns them back.

const CATEGORIES = new Set<string>(["zero", "one", "two", "few", "many", "other"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Plural forms: only CLDR category keys, `other` included. Groups such as `format` have other keys too. */
export function isPlural(value: unknown): value is Record<string, string> {
  return isRecord(value) && typeof value.other === "string" && Object.keys(value).every((key) => CATEGORIES.has(key));
}

/** The translation as nested objects again, shaped by the English strings. */
export function unpackLocale(packed: string, en: Record<string, unknown>): Record<string, unknown> | undefined {
  return unflatten(JSON.parse(new TextDecoder().decode(inflateRaw(fromBase64(packed)))), en);
}

function unflatten(values: unknown, base: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(values)) return undefined;
  const out: Record<string, unknown> = {};
  Object.entries(base).forEach(([key, value], index) => {
    const item: unknown = values[index];
    if (item === null || item === undefined) return;
    if (typeof value === "string" || isPlural(value)) out[key] = item;
    else if (isRecord(value)) {
      const nested = unflatten(item, value);
      if (nested) out[key] = nested;
    }
  });
  return out;
}

function fromBase64(text: string) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Raw DEFLATE (RFC 1951), after zlib's puff.c. Synchronous, so the active language is ready as soon as the plugin loads.

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

type Huffman = { counts: Uint16Array; symbols: Uint16Array };

function huffman(lengths: ArrayLike<number>): Huffman {
  const counts = new Uint16Array(16);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let length = 1; length < 15; length++) offsets[length + 1] = offsets[length] + counts[length];
  const symbols = new Uint16Array(lengths.length);
  for (let symbol = 0; symbol < lengths.length; symbol++) if (lengths[symbol]) symbols[offsets[lengths[symbol]]++] = symbol;
  return { counts, symbols };
}

const FIXED = (() => {
  const lengths = new Uint8Array(288);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);
  return { lengths: huffman(lengths), distances: huffman(new Uint8Array(30).fill(5)) };
})();

export function inflateRaw(input: Uint8Array): Uint8Array {
  let position = 0;
  let buffer = 0;
  let count = 0;
  let out = new Uint8Array(Math.max(1024, input.length * 4));
  let size = 0;

  const bits = (need: number) => {
    while (count < need) {
      if (position >= input.length) throw new Error("Unexpected end of compressed data");
      buffer |= input[position++] << count;
      count += 8;
    }
    const value = buffer & ((1 << need) - 1);
    buffer >>>= need;
    count -= need;
    return value;
  };
  const reserve = (extra: number) => {
    if (size + extra <= out.length) return;
    const grown = new Uint8Array(Math.max(out.length * 2, size + extra));
    grown.set(out.subarray(0, size));
    out = grown;
  };
  const decode = ({ counts, symbols }: Huffman) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let length = 1; length < 16; length++) {
      code |= bits(1);
      const n = counts[length];
      if (code - n < first) return symbols[index + (code - first)];
      index += n;
      first = (first + n) << 1;
      code <<= 1;
    }
    throw new Error("Invalid Huffman code");
  };
  const codes = (lengths: Huffman, distances: Huffman) => {
    for (;;) {
      const symbol = decode(lengths);
      if (symbol < 256) {
        reserve(1);
        out[size++] = symbol;
      } else if (symbol === 256) {
        return;
      } else {
        const lengthIndex = symbol - 257;
        if (lengthIndex >= 29) throw new Error("Invalid length code");
        const length = LENGTH_BASE[lengthIndex] + bits(LENGTH_EXTRA[lengthIndex]);
        const distanceIndex = decode(distances);
        if (distanceIndex >= 30) throw new Error("Invalid distance code");
        const distance = DISTANCE_BASE[distanceIndex] + bits(DISTANCE_EXTRA[distanceIndex]);
        if (distance > size) throw new Error("Distance too far back");
        reserve(length);
        for (let i = 0; i < length; i++, size++) out[size] = out[size - distance];
      }
    }
  };

  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      buffer = 0;
      count = 0;
      if (position + 4 > input.length) throw new Error("Unexpected end of compressed data");
      const length = input[position] | (input[position + 1] << 8);
      position += 4;
      if (position + length > input.length) throw new Error("Unexpected end of compressed data");
      reserve(length);
      out.set(input.subarray(position, position + length), size);
      size += length;
      position += length;
    } else if (type === 1) {
      codes(FIXED.lengths, FIXED.distances);
    } else if (type === 2) {
      const literalCount = bits(5) + 257;
      const distanceCount = bits(5) + 1;
      const lengthCount = bits(4) + 4;
      const codeLengths = new Uint8Array(19);
      for (let i = 0; i < lengthCount; i++) codeLengths[CODE_LENGTH_ORDER[i]] = bits(3);
      const lengthCode = huffman(codeLengths);
      const lengths = new Uint8Array(literalCount + distanceCount);
      for (let i = 0; i < lengths.length; ) {
        const symbol = decode(lengthCode);
        if (symbol < 16) {
          lengths[i++] = symbol;
          continue;
        }
        let repeat: number;
        let value = 0;
        if (symbol === 16) {
          if (i === 0) throw new Error("Repeat with no previous length");
          value = lengths[i - 1];
          repeat = 3 + bits(2);
        } else if (symbol === 17) repeat = 3 + bits(3);
        else repeat = 11 + bits(7);
        if (i + repeat > lengths.length) throw new Error("Too many lengths");
        lengths.fill(value, i, i + repeat);
        i += repeat;
      }
      codes(huffman(lengths.subarray(0, literalCount)), huffman(lengths.subarray(literalCount)));
    } else {
      throw new Error("Invalid block type");
    }
  }
  return out.subarray(0, size);
}
