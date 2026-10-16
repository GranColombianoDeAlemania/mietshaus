// Builds a small PDF with an embedded factur-x.xml (like a ZUGFeRD invoice) for tests.
function zugferdPdf(xml, zeilen) {
  const text = zeilen.map((z, i) => `BT /F1 12 Tf 72 ${780 - i * 18} Td (${z.replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n');
  const xmlBuf = Buffer.from(xml, 'utf8');
  const objekte = [
    '<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(factur-x.xml) 5 0 R] >> >> /AF [5 0 R] >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    { stream: Buffer.from(text, 'latin1'), dict: '' },
    '<< /Type /Filespec /F (factur-x.xml) /UF (factur-x.xml) /EF << /F 6 0 R >> /AFRelationship /Alternative >>',
    { stream: xmlBuf, dict: '/Type /EmbeddedFile /Subtype /text#2Fxml' },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  const teile = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let laenge = teile[0].length;
  objekte.forEach((o, i) => {
    const kopf = `${i + 1} 0 obj\n`;
    let buf;
    if (typeof o === 'string') buf = Buffer.from(`${kopf}${o}\nendobj\n`, 'latin1');
    else buf = Buffer.concat([Buffer.from(`${kopf}<< ${o.dict} /Length ${o.stream.length} >>\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    offsets.push(laenge);
    teile.push(buf);
    laenge += buf.length;
  });
  const xref = `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  teile.push(Buffer.from(`${xref}trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${laenge}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(teile);
}
module.exports = { zugferdPdf };
