// PNG chunks, read and written, for the images that carry their diagram in
// both engines (#439, #447): Draw.io keeps the file in a zTXt chunk, Excalidraw
// keeps the scene in a tEXt chunk. A chunk is a length, a four-letter type, the
// data and a CRC-32 over type and data. zlib.crc32 only arrived in Node 22.2,
// so the table is written out here.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const isPng = (bytes) => bytes.length >= 8 && bytes.subarray(0, 8).equals(SIGNATURE);

// [{ type, data }] in file order, or null when the bytes are not a whole PNG.
export function readChunks(bytes) {
  if (!isPng(bytes)) return null;
  const chunks = [];
  for (let at = 8; at < bytes.length;) {
    if (at + 12 > bytes.length) return null;
    const length = bytes.readUInt32BE(at);
    if (at + 12 + length > bytes.length) return null;
    chunks.push({ type: bytes.toString('latin1', at + 4, at + 8), data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return chunks;
}

export function writeChunks(chunks) {
  return Buffer.concat([SIGNATURE, ...chunks.flatMap(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return [head, data, crc];
  })]);
}

// The body of the first tEXt or zTXt chunk under `keyword`: the text after the
// keyword, or for zTXt the still-compressed bytes after the method byte.
export function textChunk(bytes, type, keyword) {
  const key = Buffer.from(`${keyword}\0`, 'latin1');
  const chunk = readChunks(bytes)?.find((c) => c.type === type && c.data.subarray(0, key.length).equals(key));
  if (!chunk) return null;
  return chunk.data.subarray(key.length + (type === 'zTXt' ? 1 : 0));
}

// The PNG with one text chunk under `keyword` holding `body`, straight after
// IHDR: Excalidraw reads only the first tEXt chunk. One already under that
// keyword is replaced, never kept beside it.
export function withTextChunk(bytes, type, keyword, body) {
  const chunks = readChunks(bytes);
  if (!chunks || chunks[0]?.type !== 'IHDR') throw new Error('not a PNG');
  const key = Buffer.from(`${keyword}\0`, 'latin1');
  const data = Buffer.concat([key, type === 'zTXt' ? Buffer.from([0]) : Buffer.alloc(0), body]);
  const kept = chunks.filter((c) => !(c.type === type && c.data.subarray(0, key.length).equals(key)));
  return writeChunks([kept[0], { type, data }, ...kept.slice(1)]);
}
