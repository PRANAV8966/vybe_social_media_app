/**
 * Magic-byte content sniffing — verifies what a file actually IS, never
 * trusting the client-supplied mimetype/extension alone (both are trivially
 * spoofable). Pure, generic, zero-domain-knowledge byte comparisons — the
 * same category of shared utility as asyncHandler or the validate
 * middleware, not a domain abstraction.
 */

function matchesBytes(buffer, offset, expectedBytes) {
  if (buffer.length < offset + expectedBytes.length) return false;
  for (let i = 0; i < expectedBytes.length; i += 1) {
    if (buffer[offset + i] !== expectedBytes[i]) return false;
  }
  return true;
}

function isPNG(buffer) {
  return matchesBytes(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function isJPEG(buffer) {
  return matchesBytes(buffer, 0, [0xff, 0xd8, 0xff]);
}

function isWebP(buffer) {
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}

/** Covers both MP4 and MOV — both are ISO Base Media File Format containers; the "ftyp" box always starts at byte offset 4. */
function isIsoBmff(buffer) {
  return buffer.length >= 8 && buffer.toString('ascii', 4, 8) === 'ftyp';
}

function isWebM(buffer) {
  return matchesBytes(buffer, 0, [0x1a, 0x45, 0xdf, 0xa3]);
}

function detectImageType(buffer) {
  if (isPNG(buffer)) return { mediaType: 'image', ext: 'png', contentType: 'image/png' };
  if (isJPEG(buffer)) return { mediaType: 'image', ext: 'jpg', contentType: 'image/jpeg' };
  if (isWebP(buffer)) return { mediaType: 'image', ext: 'webp', contentType: 'image/webp' };
  return null;
}

/** `hintedMimeType` (client-supplied, untrusted) is used only to pick a cosmetic mp4-vs-mov extension — never for the security decision itself. */
function detectVideoType(buffer, hintedMimeType) {
  if (isWebM(buffer)) return { mediaType: 'video', ext: 'webm', contentType: 'video/webm' };
  if (isIsoBmff(buffer)) {
    const isMov = hintedMimeType === 'video/quicktime';
    return isMov
      ? { mediaType: 'video', ext: 'mov', contentType: 'video/quicktime' }
      : { mediaType: 'video', ext: 'mp4', contentType: 'video/mp4' };
  }
  return null;
}

function detectMediaType(buffer, hintedMimeType) {
  return detectImageType(buffer) || detectVideoType(buffer, hintedMimeType) || null;
}

module.exports = { detectImageType, detectVideoType, detectMediaType };
