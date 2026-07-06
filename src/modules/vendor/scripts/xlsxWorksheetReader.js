const yauzl = require('yauzl');

function decodeXml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function columnIndex(cellRef = '') {
  const letters = String(cellRef).match(/^[A-Z]+/i);
  if (!letters) return 0;
  return letters[0].toUpperCase().split('').reduce((sum, char) => (sum * 26) + char.charCodeAt(0) - 64, 0) - 1;
}

function readZipEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  });
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zip) => {
      if (error) reject(error);
      else resolve(zip);
    });
  });
}

function parseSharedStrings(xml = '') {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(([, item]) => (
    decodeXml([...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([, text]) => text).join(''))
  ));
}

function cellValue(cellXml, sharedStrings) {
  const type = (cellXml.match(/\st="([^"]+)"/) || [])[1];
  if (type === 'inlineStr') {
    const inline = (cellXml.match(/<t\b[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '';
    return decodeXml(inline);
  }
  const raw = (cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1] || '';
  if (type === 's') return sharedStrings[Number(raw)] || '';
  return decodeXml(raw);
}

function parseWorksheetRows(xml = '', sharedStrings = []) {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(([, rowXml]) => {
    const row = [];
    for (const [, cellXml] of rowXml.matchAll(/(<c\b[^>]*r="[^"]+"[^>]*>[\s\S]*?<\/c>)/g)) {
      const ref = (cellXml.match(/\br="([^"]+)"/) || [])[1];
      row[columnIndex(ref)] = cellValue(cellXml, sharedStrings);
    }
    return row.map((value) => (value === undefined ? '' : value));
  });
}

async function readXlsxRows(filePath) {
  const zip = await openZip(filePath);
  const files = new Map();

  await new Promise((resolve, reject) => {
    zip.readEntry();
    zip.on('entry', async (entry) => {
      try {
        if (entry.fileName === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.fileName)) {
          files.set(entry.fileName, await readZipEntry(zip, entry));
        }
        zip.readEntry();
      } catch (error) {
        reject(error);
      }
    });
    zip.on('error', reject);
    zip.on('end', resolve);
  });

  const sharedStrings = parseSharedStrings(files.get('xl/sharedStrings.xml') || '');
  return [...files.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, xml]) => ({
      name,
      rows: parseWorksheetRows(xml, sharedStrings),
    }));
}

module.exports = {
  columnIndex,
  parseWorksheetRows,
  readXlsxRows,
};
