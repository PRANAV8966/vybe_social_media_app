/** Minimal buffers that satisfy fileSignature.js's magic-byte checks without needing real image/video fixtures. */

function fakePngBuffer(paddingBytes = 100) {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(paddingBytes)]);
}

function fakeMp4Buffer(paddingBytes = 100) {
  return Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp', 'ascii'), Buffer.alloc(paddingBytes)]);
}

function invalidMediaBuffer() {
  return Buffer.from('this is not a real image or video file', 'utf8');
}

module.exports = { fakePngBuffer, fakeMp4Buffer, invalidMediaBuffer };
