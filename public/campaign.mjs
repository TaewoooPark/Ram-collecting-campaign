export const amounts = Object.freeze([4, 8, 16]);
export const megabyte = 1_000_000;

// Four-megabyte blocks let a full counter reuse just the incoming amount.
export const holdingLimit = 64;
const blockSize = 4 * megabyte;

function detach(buffer) {
  if (typeof structuredClone === 'function') {
    try { structuredClone(null, { transfer: [buffer] }); } catch { /* Dropping the reference is sufficient. */ }
  }
}

export class Donation {
  #blocks = [];

  get byteLength() {
    return this.#blocks.length * blockSize;
  }

  hold(amount) {
    if (!amounts.includes(amount)) throw new RangeError('접수량을 확인해 주세요.');
    const count = amount * megabyte / blockSize;
    const reuse = Math.max(0, this.#blocks.length + count - holdingLimit * megabyte / blockSize);
    const incoming = this.#blocks.slice(0, reuse);
    try {
      while (incoming.length < count) incoming.push(new Uint8Array(blockSize));
      for (const bytes of incoming) {
        for (let i = 0; i < bytes.length; i += 65536) {
          crypto.getRandomValues(bytes.subarray(i, i + 65536));
        }
      }
    } catch (error) {
      for (const block of incoming.slice(reuse)) detach(block.buffer);
      throw error;
    }
    this.#blocks = this.#blocks.slice(reuse).concat(incoming);
    return amount * megabyte;
  }

  release() {
    for (const bytes of this.#blocks) detach(bytes.buffer);
    this.#blocks = [];
  }
}
