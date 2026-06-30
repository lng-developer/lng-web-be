const {
  buildZipEntryManifestEntry,
  normalizeZipEntryName,
  summarizeZipManifest,
} = require('../../../modules/customization/helpers/zipSafety.helper');

describe('zipSafety.helper', () => {
  test.each([
    ['images/design.png', 'images/design.png'],
    ['images\\design.png', 'images/design.png'],
  ])('normalizes safe path %s', (input, expected) => {
    expect(normalizeZipEntryName(input)).toEqual({
      normalizedPath: expected,
      errors: [],
    });
  });

  test.each([
    '../evil.png',
    '..\\evil.png',
    '/etc/passwd',
    'C:\\evil.png',
    'safe/../evil.png',
  ])('rejects unsafe path %s', (entryName) => {
    const result = normalizeZipEntryName(entryName);

    expect(result.errors).not.toHaveLength(0);
  });

  test('directory entries are not blocked by extension policy', () => {
    const entry = buildZipEntryManifestEntry({
      entryName: 'assets/',
      compressedSize: 0,
      uncompressedSize: 0,
      generalPurposeBitFlag: 0,
      externalFileAttributes: 0,
    }, 0);

    expect(entry.directory).toBe(true);
    expect(entry.safe).toBe(true);
    expect(entry.extension).toBe('');
  });

  test('marks executable, nested archive, encrypted, and symlink entries unsafe', () => {
    const entry = buildZipEntryManifestEntry({
      entryName: 'run.ps1',
      compressedSize: 10,
      uncompressedSize: 20,
      generalPurposeBitFlag: 1,
      externalFileAttributes: 0o120777 << 16,
    }, 0);

    expect(entry.safe).toBe(false);
    expect(entry.encrypted).toBe(true);
    expect(entry.symlink).toBe(true);
    expect(entry.errors).toEqual(expect.arrayContaining([
      'ZIP_ENTRY_ENCRYPTED',
      'ZIP_ENTRY_SYMLINK',
      'ZIP_ENTRY_UNSAFE_EXTENSION',
    ]));
  });

  test('summarizes unsafe limits as needs review', () => {
    const manifest = summarizeZipManifest([
      buildZipEntryManifestEntry({
        entryName: 'nested.zip',
        compressedSize: 1,
        uncompressedSize: 60,
        generalPurposeBitFlag: 0,
        externalFileAttributes: 0,
      }, 0),
    ], {
      maxEntries: 1,
      maxTotalUncompressedBytes: 50,
      maxSingleEntryUncompressedBytes: 10,
    });

    expect(manifest.status).toBe('NEEDS_REVIEW');
    expect(manifest.warnings).toContain('ZIP_ENTRY_NESTED_ARCHIVE');
    expect(manifest.errors).toEqual(expect.arrayContaining([
      'ZIP_TOTAL_UNCOMPRESSED_SIZE_LIMIT_EXCEEDED',
      'ZIP_ENTRY_UNCOMPRESSED_SIZE_LIMIT_EXCEEDED',
    ]));
  });
});
