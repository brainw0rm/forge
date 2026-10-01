// Share codes: each talent point is its trait node ID in three base64url characters
// (IDs < 262144), in the order the points were spent. Used by the browser and the API.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export const CHARS_PER_POINT = 3;

export function encode(order: number[]): string {
  return order
    .map((id) => ALPHABET[(id >> 12) & 63] + ALPHABET[(id >> 6) & 63] + ALPHABET[id & 63])
    .join("");
}

export function decode(code: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + CHARS_PER_POINT <= code.length; i += CHARS_PER_POINT) {
    const [a, b, c] = [0, 1, 2].map((k) => ALPHABET.indexOf(code[i + k]));
    if (a < 0 || b < 0 || c < 0) break;
    out.push((a << 12) | (b << 6) | c);
  }
  return out;
}
