// 64-bit difference hash: 9x8 grayscale, one bit per pixel that is brighter than its right neighbour.
import sharp from 'sharp';

const WIDTH = 9;
const HEIGHT = 8;
const ZERO = BigInt(0);
const ONE = BigInt(1);

export async function dhash(buffer: Buffer): Promise<string> {
  const { data, info } = await sharp(buffer)
    .grayscale()
    .resize(WIDTH, HEIGHT, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => data[(y * WIDTH + x) * info.channels];
  let bits = ZERO;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH - 1; x++) bits = (bits << ONE) | (at(x, y) > at(x + 1, y) ? ONE : ZERO);
  }
  return bits.toString(16).padStart(16, '0');
}

/** The four 4-hex-char slices, used as LSH bands (a near-duplicate usually shares at least one). */
export function bands(hex: string): [string, string, string, string] {
  return [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8, 12), hex.slice(12, 16)];
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  for (; x > ZERO; x >>= ONE) count += Number(x & ONE);
  return count;
}
