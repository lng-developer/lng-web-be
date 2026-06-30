const path = require('path');
const { customizationZipInspectionStatuses } = require('../constants/customizationZipInspectionStatuses');

const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 50,
  maxTotalUncompressedBytes: 50 * 1024 * 1024,
  maxSingleEntryUncompressedBytes: 20 * 1024 * 1024,
});

const UNSAFE_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.sh', '.js', '.vbs', '.ps1', '.msi']);
const NESTED_ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z']);
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.txt', '.json', '.csv']);

function normalizeZipEntryName(entryName = '') {
  const original = String(entryName || '');
  const slashed = original.replace(/\\/g, '/');
  const errors = [];

  if (!slashed) {
    errors.push('ZIP_ENTRY_PATH_EMPTY');
  }

  if (slashed.startsWith('/')) {
    errors.push('ZIP_ENTRY_ABSOLUTE_PATH');
  }

  if (/^[A-Za-z]:/.test(slashed)) {
    errors.push('ZIP_ENTRY_WINDOWS_DRIVE_PATH');
  }

  const segments = slashed.split('/');

  if (segments.includes('..')) {
    errors.push('ZIP_ENTRY_PATH_TRAVERSAL');
  }

  const normalizedPath = path.posix.normalize(slashed).replace(/^\.\/+/, '');

  return {
    normalizedPath,
    errors,
  };
}

function isDirectoryEntry(entryName = '') {
  return String(entryName).replace(/\\/g, '/').endsWith('/');
}

function isEncrypted(entry = {}) {
  return Boolean(entry.generalPurposeBitFlag & 0x1);
}

function isSymlink(entry = {}) {
  const mode = ((entry.externalFileAttributes || 0) >>> 16) & 0o170000;
  return mode === 0o120000;
}

function detectedTypeForExtension(extension, directory) {
  if (directory) return 'directory';
  if (ALLOWED_EXTENSIONS.has(extension)) return extension.slice(1);
  if (NESTED_ARCHIVE_EXTENSIONS.has(extension)) return 'archive';
  if (UNSAFE_EXTENSIONS.has(extension)) return 'executable';
  return extension ? 'unknown' : 'unknown';
}

function addSizeErrors(entryManifest, limits) {
  if (!Number.isFinite(entryManifest.compressedSize) || entryManifest.compressedSize < 0) {
    entryManifest.errors.push('ZIP_ENTRY_COMPRESSED_SIZE_INVALID');
  }

  if (!Number.isFinite(entryManifest.uncompressedSize) || entryManifest.uncompressedSize < 0) {
    entryManifest.errors.push('ZIP_ENTRY_UNCOMPRESSED_SIZE_INVALID');
  }

  if (entryManifest.uncompressedSize > limits.maxSingleEntryUncompressedBytes) {
    entryManifest.errors.push('ZIP_ENTRY_UNCOMPRESSED_SIZE_LIMIT_EXCEEDED');
  }
}

function buildZipEntryManifestEntry(entry = {}, index, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const originalPath = String(entry.entryName || entry.fileName || '');
  const { normalizedPath, errors } = normalizeZipEntryName(originalPath);
  const directory = isDirectoryEntry(originalPath);
  const filename = directory ? '' : path.posix.basename(normalizedPath);
  const extension = directory ? '' : path.posix.extname(filename).toLowerCase();
  const warnings = [];
  const entryErrors = [...errors];
  const encrypted = isEncrypted(entry);
  const symlink = isSymlink(entry);
  const manifestEntry = {
    index,
    originalPath,
    normalizedPath,
    filename,
    extension,
    directory,
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
    encrypted,
    symlink,
    detectedType: detectedTypeForExtension(extension, directory),
    safe: true,
    warnings,
    errors: entryErrors,
  };

  if (encrypted) entryErrors.push('ZIP_ENTRY_ENCRYPTED');
  if (symlink) entryErrors.push('ZIP_ENTRY_SYMLINK');

  if (!directory) {
    if (UNSAFE_EXTENSIONS.has(extension)) {
      entryErrors.push('ZIP_ENTRY_UNSAFE_EXTENSION');
    } else if (NESTED_ARCHIVE_EXTENSIONS.has(extension)) {
      warnings.push('ZIP_ENTRY_NESTED_ARCHIVE');
    } else if (extension && !ALLOWED_EXTENSIONS.has(extension)) {
      warnings.push('ZIP_ENTRY_UNKNOWN_EXTENSION');
    }
  }

  addSizeErrors(manifestEntry, limits);
  manifestEntry.safe = entryErrors.length === 0;

  return manifestEntry;
}

function summarizeZipManifest(entries = [], options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const warnings = [...new Set(entries.flatMap((entry) => entry.warnings || []))];
  const errors = [...new Set(entries.flatMap((entry) => entry.errors || []))];
  const fileCount = entries.filter((entry) => !entry.directory).length;
  const directoryCount = entries.filter((entry) => entry.directory).length;
  const totalCompressedBytes = entries.reduce((total, entry) => total + (entry.compressedSize || 0), 0);
  const totalUncompressedBytes = entries.reduce((total, entry) => total + (entry.uncompressedSize || 0), 0);

  if (entries.length > limits.maxEntries) {
    errors.push('ZIP_ENTRY_COUNT_LIMIT_EXCEEDED');
  }

  if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
    errors.push('ZIP_TOTAL_UNCOMPRESSED_SIZE_LIMIT_EXCEEDED');
  }

  if (entries.some((entry) => entry.uncompressedSize > limits.maxSingleEntryUncompressedBytes)) {
    errors.push('ZIP_ENTRY_UNCOMPRESSED_SIZE_LIMIT_EXCEEDED');
  }

  return {
    status: errors.length ? customizationZipInspectionStatuses.NEEDS_REVIEW : customizationZipInspectionStatuses.INSPECTED,
    fileCount,
    directoryCount,
    totalCompressedBytes,
    totalUncompressedBytes,
    warnings: [...new Set(warnings)],
    errors: [...new Set(errors)],
  };
}

module.exports = {
  DEFAULT_LIMITS,
  buildZipEntryManifestEntry,
  normalizeZipEntryName,
  summarizeZipManifest,
};
