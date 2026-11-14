'use strict';

// Chrome extension messages use JSON serialization. Transfer bounded chunks
// with acknowledgements rather than base64-encoding the entire book at once.
const BookpostWire = (() => {
  const CHUNK = 384 * 1024;
  function encode(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x4000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
    }
    return btoa(binary);
  }
  function decode(text) {
    if (typeof text !== 'string' || text.length > Math.ceil(CHUNK / 3) * 4) {
      throw new Error('Invalid transfer chunk.');
    }
    const binary = atob(text);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }
  return { CHUNK, encode, decode };
})();
