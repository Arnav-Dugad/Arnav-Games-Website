/**
 * Tiny, dependency-free image decoders for colour sampling.
 *
 * Palette extraction only needs a few thousand pixels, never a faithful
 * image, and it has to run on Cloudflare Workers — no `sharp`, no canvas, no
 * Node `Buffer`/`zlib`. So this file carries two deliberately narrow decoders:
 *
 *  - PNG, complete for non-interlaced images (every colour type, bit depths
 *    1–16), inflating with the platform's `DecompressionStream`. IGDB will
 *    re-encode any asset as PNG on request, so this is the primary path.
 *  - Baseline JPEG, *DC coefficients only*. A block's DC term is its average
 *    colour, so skipping the inverse DCT yields an exact 1/8-scale thumbnail
 *    for a fraction of the code. Steam serves JPEG only, which is why this
 *    exists. Progressive and arithmetic-coded JPEGs return null.
 *
 * Both return straight RGBA and never throw: a malformed file is `null`.
 */

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

/** Hard ceiling so a hostile or mislabelled file can't allocate unbounded memory. */
const MAX_PIXELS = 4_000_000;

export async function decodeImage(bytes: Uint8Array): Promise<DecodedImage | null> {
  if (isPng(bytes)) return decodePng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return decodeJpegDc(bytes);
  return null;
}

/* ---------------------------------------------------------------------------
 * PNG
 * ------------------------------------------------------------------------ */

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // "deflate" is the zlib-wrapped format, which is exactly what IDAT carries.
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodePng(bytes: Uint8Array): Promise<DecodedImage | null> {
  try {
    if (!isPng(bytes)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let width = 0;
    let height = 0;
    let depth = 0;
    let colorType = 0;
    let interlace = 0;
    let palette: Uint8Array | null = null;
    let transparency: Uint8Array | null = null;
    const idat: Uint8Array[] = [];

    for (let offset = 8; offset + 8 <= bytes.length; ) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      const body = bytes.subarray(offset + 8, offset + 8 + length);
      if (type === "IHDR") {
        width = view.getUint32(offset + 8);
        height = view.getUint32(offset + 12);
        depth = body[8];
        colorType = body[9];
        interlace = body[12];
      } else if (type === "PLTE") palette = body;
      else if (type === "tRNS") transparency = body;
      else if (type === "IDAT") idat.push(body);
      else if (type === "IEND") break;
      offset += 12 + length;
    }

    if (!width || !height || width * height > MAX_PIXELS || interlace !== 0) return null;
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    if (!channels || ![1, 2, 4, 8, 16].includes(depth)) return null;
    if (colorType === 3 && !palette) return null;

    const joined = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
    let cursor = 0;
    for (const part of idat) {
      joined.set(part, cursor);
      cursor += part.length;
    }
    const raw = await inflate(joined);

    const bitsPerPixel = channels * depth;
    const stride = Math.ceil((width * bitsPerPixel) / 8);
    const bpp = Math.max(1, bitsPerPixel >> 3);
    if (raw.length < height * (stride + 1)) return null;

    // Undo the per-scanline filters in place.
    const lines = new Uint8Array(height * stride);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)];
      const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      const out = lines.subarray(y * stride, (y + 1) * stride);
      const prev = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : null;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? out[x - bpp] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= bpp ? prev[x - bpp] : 0;
        let value = src[x];
        if (filter === 1) value += a;
        else if (filter === 2) value += b;
        else if (filter === 3) value += (a + b) >> 1;
        else if (filter === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        } else if (filter !== 0) return null;
        out[x] = value & 0xff;
      }
    }

    // Reads sample `i` of a scanline at any bit depth, scaled to 0–255.
    const sample = (line: Uint8Array, i: number): number => {
      if (depth === 8) return line[i];
      if (depth === 16) return line[i * 2];
      const bit = i * depth;
      const value = (line[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      return colorType === 3 ? value : Math.round((value * 255) / ((1 << depth) - 1));
    };

    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const line = lines.subarray(y * stride, (y + 1) * stride);
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const s = x * channels;
        if (colorType === 3) {
          const index = sample(line, x);
          data[o] = palette![index * 3] ?? 0;
          data[o + 1] = palette![index * 3 + 1] ?? 0;
          data[o + 2] = palette![index * 3 + 2] ?? 0;
          data[o + 3] = transparency && index < transparency.length ? transparency[index] : 255;
        } else if (colorType === 0 || colorType === 4) {
          const gray = sample(line, s);
          data[o] = data[o + 1] = data[o + 2] = gray;
          data[o + 3] = colorType === 4 ? sample(line, s + 1) : 255;
        } else {
          data[o] = sample(line, s);
          data[o + 1] = sample(line, s + 1);
          data[o + 2] = sample(line, s + 2);
          data[o + 3] = colorType === 6 ? sample(line, s + 3) : 255;
        }
      }
    }
    return { width, height, data };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * JPEG (baseline, DC only)
 * ------------------------------------------------------------------------ */

interface Huffman {
  /** Maps `(length << 16) | code` to the decoded symbol. */
  lookup: Map<number, number>;
}

function buildHuffman(counts: Uint8Array, symbols: Uint8Array): Huffman {
  const lookup = new Map<number, number>();
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < counts[length - 1]; i++) {
      lookup.set((length << 16) | code, symbols[k++]);
      code++;
    }
    code <<= 1;
  }
  return { lookup };
}

interface Component {
  id: number;
  h: number;
  v: number;
  tq: number;
  td: number;
  ta: number;
  /** DC averages per 8×8 block, in this component's own block grid. */
  blocks: Float32Array;
  blocksPerLine: number;
  blocksPerColumn: number;
  pred: number;
}

export function decodeJpegDc(bytes: Uint8Array): DecodedImage | null {
  try {
    const quant = new Map<number, Uint16Array>();
    const dcTables = new Map<number, Huffman>();
    const acTables = new Map<number, Huffman>();
    let components: Component[] = [];
    let width = 0;
    let height = 0;
    let restartInterval = 0;
    let adobeTransform = -1;

    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      const body = bytes.subarray(offset + 4, offset + 2 + length);

      if (marker === 0xdb) {
        for (let p = 0; p < body.length; ) {
          const precision = body[p] >> 4;
          const id = body[p] & 15;
          const table = new Uint16Array(64);
          for (let i = 0; i < 64; i++) {
            table[i] = precision ? (body[p + 1 + i * 2] << 8) | body[p + 2 + i * 2] : body[p + 1 + i];
          }
          quant.set(id, table);
          p += 1 + 64 * (precision ? 2 : 1);
        }
      } else if (marker === 0xc0 || marker === 0xc1) {
        height = (body[1] << 8) | body[2];
        width = (body[3] << 8) | body[4];
        components = [];
        for (let i = 0; i < body[5]; i++) {
          const base = 6 + i * 3;
          components.push({
            id: body[base], h: body[base + 1] >> 4, v: body[base + 1] & 15, tq: body[base + 2],
            td: 0, ta: 0, blocks: new Float32Array(0), blocksPerLine: 0, blocksPerColumn: 0, pred: 0,
          });
        }
      } else if (marker >= 0xc2 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        // Progressive, lossless or arithmetic: out of scope for a sampler.
        return null;
      } else if (marker === 0xc4) {
        for (let p = 0; p < body.length; ) {
          const tableClass = body[p] >> 4;
          const id = body[p] & 15;
          const counts = body.subarray(p + 1, p + 17);
          const total = counts.reduce((sum, value) => sum + value, 0);
          const table = buildHuffman(counts, body.subarray(p + 17, p + 17 + total));
          (tableClass === 0 ? dcTables : acTables).set(id, table);
          p += 17 + total;
        }
      } else if (marker === 0xdd) {
        restartInterval = (body[0] << 8) | body[1];
      } else if (marker === 0xee && String.fromCharCode(...body.subarray(0, 5)) === "Adobe") {
        adobeTransform = body[11];
      } else if (marker === 0xda) {
        if (!width || !height || components.length === 0 || width * height > MAX_PIXELS * 64) return null;
        const scanCount = body[0];
        for (let i = 0; i < scanCount; i++) {
          const component = components.find((c) => c.id === body[1 + i * 2]);
          if (!component) return null;
          component.td = body[2 + i * 2] >> 4;
          component.ta = body[2 + i * 2] & 15;
        }
        // Only single-scan baseline files reach here, so every component is in it.
        if (scanCount !== components.length) return null;
        const end = decodeScan(bytes, offset + 2 + length, components, width, height, restartInterval, quant, dcTables, acTables);
        if (end < 0) return null;
        return toRgba(components, width, height, adobeTransform);
      }
      offset += 2 + length;
    }
    return null;
  } catch {
    return null;
  }
}

function decodeScan(
  bytes: Uint8Array,
  start: number,
  components: Component[],
  width: number,
  height: number,
  restartInterval: number,
  quant: Map<number, Uint16Array>,
  dcTables: Map<number, Huffman>,
  acTables: Map<number, Huffman>,
): number {
  const hMax = Math.max(...components.map((c) => c.h));
  const vMax = Math.max(...components.map((c) => c.v));
  const mcusX = Math.ceil(width / (8 * hMax));
  const mcusY = Math.ceil(height / (8 * vMax));
  for (const c of components) {
    c.blocksPerLine = mcusX * c.h;
    c.blocksPerColumn = mcusY * c.v;
    c.blocks = new Float32Array(c.blocksPerLine * c.blocksPerColumn);
    c.pred = 0;
  }

  let pos = start;
  let bitBuffer = 0;
  let bitCount = 0;
  const readBit = (): number => {
    if (bitCount === 0) {
      if (pos >= bytes.length) throw new Error("eof");
      const byte = bytes[pos++];
      if (byte === 0xff) {
        // A stuffed 0xFF00 is data. Any real marker here (including RSTn, which
        // the MCU loop steps over itself) means the stream is out of sync.
        if (bytes[pos] !== 0) throw new Error("marker");
        pos++;
      }
      bitBuffer = byte;
      bitCount = 8;
    }
    bitCount--;
    return (bitBuffer >> bitCount) & 1;
  };
  const decodeSymbol = (table: Huffman): number => {
    let code = 0;
    for (let length = 1; length <= 16; length++) {
      code = (code << 1) | readBit();
      const symbol = table.lookup.get((length << 16) | code);
      if (symbol !== undefined) return symbol;
    }
    throw new Error("bad huffman code");
  };
  const receiveExtend = (size: number): number => {
    if (size === 0) return 0;
    let value = 0;
    for (let i = 0; i < size; i++) value = (value << 1) | readBit();
    return value < 1 << (size - 1) ? value - (1 << size) + 1 : value;
  };

  const decodeBlock = (c: Component, row: number, col: number) => {
    const dc = dcTables.get(c.td);
    const ac = acTables.get(c.ta);
    const q = quant.get(c.tq);
    if (!dc || !ac || !q) throw new Error("missing table");
    c.pred += receiveExtend(decodeSymbol(dc));
    // Walk the AC coefficients only to stay aligned with the bitstream.
    for (let k = 1; k < 64; ) {
      const rs = decodeSymbol(ac);
      const size = rs & 15;
      const run = rs >> 4;
      if (size === 0) {
        if (run !== 15) break;
        k += 16;
        continue;
      }
      k += run;
      for (let i = 0; i < size; i++) readBit();
      k++;
    }
    if (row < c.blocksPerColumn && col < c.blocksPerLine) {
      // DC of an orthonormal 8×8 DCT is 8× the block mean (after level shift).
      c.blocks[row * c.blocksPerLine + col] = (c.pred * q[0]) / 8 + 128;
    }
  };

  const totalMcus = mcusX * mcusY;
  for (let mcu = 0; mcu < totalMcus; mcu++) {
    if (restartInterval && mcu > 0 && mcu % restartInterval === 0) {
      // Byte-align and step over the RSTn marker, then reset predictors.
      bitCount = 0;
      while (pos + 1 < bytes.length && !(bytes[pos] === 0xff && bytes[pos + 1] >= 0xd0 && bytes[pos + 1] <= 0xd7)) pos++;
      pos += 2;
      for (const c of components) c.pred = 0;
    }
    const mcuRow = Math.floor(mcu / mcusX);
    const mcuCol = mcu % mcusX;
    for (const c of components) {
      for (let v = 0; v < c.v; v++) {
        for (let h = 0; h < c.h; h++) {
          decodeBlock(c, mcuRow * c.v + v, mcuCol * c.h + h);
        }
      }
    }
  }
  return pos;
}

function toRgba(components: Component[], width: number, height: number, adobeTransform: number): DecodedImage | null {
  const hMax = Math.max(...components.map((c) => c.h));
  const vMax = Math.max(...components.map((c) => c.v));
  // One output pixel per luma-resolution 8×8 block.
  const outW = Math.max(1, Math.ceil(width / 8));
  const outH = Math.max(1, Math.ceil(height / 8));
  const data = new Uint8Array(outW * outH * 4);
  const clamp = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));
  const at = (c: Component, x: number, y: number) => {
    const col = Math.min(c.blocksPerLine - 1, Math.floor((x * c.h) / hMax));
    const row = Math.min(c.blocksPerColumn - 1, Math.floor((y * c.v) / vMax));
    return c.blocks[row * c.blocksPerLine + col];
  };
  // JFIF three-component images are YCbCr unless an Adobe marker says RGB.
  const ycc = components.length === 3 && adobeTransform !== 0;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const o = (y * outW + x) * 4;
      if (components.length === 1) {
        data[o] = data[o + 1] = data[o + 2] = clamp(at(components[0], x, y));
      } else if (components.length === 3) {
        const a = at(components[0], x, y);
        const b = at(components[1], x, y);
        const c = at(components[2], x, y);
        if (ycc) {
          data[o] = clamp(a + 1.402 * (c - 128));
          data[o + 1] = clamp(a - 0.344136 * (b - 128) - 0.714136 * (c - 128));
          data[o + 2] = clamp(a + 1.772 * (b - 128));
        } else {
          data[o] = clamp(a);
          data[o + 1] = clamp(b);
          data[o + 2] = clamp(c);
        }
      } else {
        return null; // CMYK covers are vanishingly rare; not worth the code.
      }
      data[o + 3] = 255;
    }
  }
  return { width: outW, height: outH, data };
}
