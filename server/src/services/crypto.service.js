const CryptoJS = require('crypto-js');

const KEY = process.env.ENCRYPTION_KEY || 'CHANGE_ME_32_CHAR_KEY___________';

/**
 * Encrypt a plaintext string using AES-256.
 * Returns '' if input is falsy.
 */
const encrypt = (plain) => {
  if (!plain) return '';
  return CryptoJS.AES.encrypt(String(plain), KEY).toString();
};

/**
 * Decrypt an AES-256 encrypted string.
 * Returns '' if input is falsy or decryption fails.
 */
const decrypt = (cipher) => {
  if (!cipher) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(cipher, KEY);
    return bytes.toString(CryptoJS.enc.Utf8) || '';
  } catch {
    return '';
  }
};

module.exports = { encrypt, decrypt };
