const { detectImageType, detectVideoType, detectMediaType } = require('../../src/uploads/fileSignature');
const { fakePngBuffer, fakeMp4Buffer, invalidMediaBuffer } = require('../helpers/mediaFixtures');

describe('fileSignature (magic-byte content sniffing)', () => {
  it('detects PNG by its signature bytes, ignoring the client-claimed mimetype', () => {
    expect(detectImageType(fakePngBuffer())).toEqual({ mediaType: 'image', ext: 'png', contentType: 'image/png' });
  });

  it('detects JPEG by its signature bytes', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(50)]);
    expect(detectImageType(buf)).toEqual({ mediaType: 'image', ext: 'jpg', contentType: 'image/jpeg' });
  });

  it('detects WebP via its RIFF/WEBP container markers', () => {
    const buf = Buffer.alloc(20);
    buf.write('RIFF', 0, 'ascii');
    buf.write('WEBP', 8, 'ascii');
    expect(detectImageType(buf)).toEqual({ mediaType: 'image', ext: 'webp', contentType: 'image/webp' });
  });

  it('detects an ISO-BMFF ("ftyp") container as MP4 by default', () => {
    expect(detectVideoType(fakeMp4Buffer(), 'video/mp4')).toEqual({ mediaType: 'video', ext: 'mp4', contentType: 'video/mp4' });
  });

  it('detects an ISO-BMFF container as MOV when the client hints video/quicktime', () => {
    expect(detectVideoType(fakeMp4Buffer(), 'video/quicktime')).toEqual({
      mediaType: 'video',
      ext: 'mov',
      contentType: 'video/quicktime',
    });
  });

  it('detects WebM via its EBML header', () => {
    const buf = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(50)]);
    expect(detectVideoType(buf)).toEqual({ mediaType: 'video', ext: 'webm', contentType: 'video/webm' });
  });

  it('returns null for content matching no known signature, regardless of a spoofed mimetype', () => {
    const buf = invalidMediaBuffer();
    expect(detectImageType(buf)).toBeNull();
    expect(detectVideoType(buf)).toBeNull();
    expect(detectMediaType(buf, 'image/png')).toBeNull(); // claiming to be a PNG doesn't make it one
  });

  it('does not misdetect a too-short buffer', () => {
    expect(detectImageType(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(detectVideoType(Buffer.from([0x1a]))).toBeNull();
  });

  it('detectMediaType tries images before video and returns the first match', () => {
    expect(detectMediaType(fakePngBuffer())).toEqual({ mediaType: 'image', ext: 'png', contentType: 'image/png' });
    expect(detectMediaType(fakeMp4Buffer())).toEqual({ mediaType: 'video', ext: 'mp4', contentType: 'video/mp4' });
  });
});
