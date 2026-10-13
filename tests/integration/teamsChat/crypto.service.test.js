const cryptoService = require('../../../src/modules/integration/teamsChat/services/crypto.service');

describe('Teams crypto service', () => {
  test('encrypts and decrypts text accurately', () => {
    const secret = 'refresh-token-sample-12345-abcdef';
    const encrypted = cryptoService.encrypt(secret);

    expect(encrypted).toBeTruthy();
    expect(encrypted).not.toBe(secret);

    const decrypted = cryptoService.decrypt(encrypted);
    expect(decrypted).toBe(secret);
  });

  test('generates different ciphertexts for same plaintext due to random IV', () => {
    const secret = 'identical-secret';
    const encrypted1 = cryptoService.encrypt(secret);
    const encrypted2 = cryptoService.encrypt(secret);

    expect(encrypted1).not.toBe(encrypted2);
    expect(cryptoService.decrypt(encrypted1)).toBe(secret);
    expect(cryptoService.decrypt(encrypted2)).toBe(secret);
  });

  test('returns null for tampered ciphertext', () => {
    const encrypted = cryptoService.encrypt('sensitive-data');
    const tampered = `${encrypted.slice(0, -4)}AAAA`;

    const decrypted = cryptoService.decrypt(tampered);
    expect(decrypted).toBeNull();
  });

  test('handles null and empty values gracefully', () => {
    expect(cryptoService.encrypt(null)).toBeNull();
    expect(cryptoService.encrypt('')).toBeNull();
    expect(cryptoService.decrypt(null)).toBeNull();
    expect(cryptoService.decrypt('')).toBeNull();
  });
});
