const stream = contents => `<< /Length ${contents.length} >>\nstream\n${contents}\nendstream`;

export function previewPdf(link, secondPageColor = '0.1 0.5 0.35') {
  const contents = (color, title, line) => stream(`${color} rg 0 468 440 92 re f
1 1 1 rg BT /F1 23 Tf 30 502 Td (${title}) Tj ET
0.1 0.15 0.2 rg BT /F1 13 Tf 30 423 Td (${line}) Tj ET
0.87 0.90 0.94 rg 30 370 380 1 re f
0.1 0.15 0.2 rg BT /F1 11 Tf 30 345 Td (Desktop for Step Code / Document preview fixture) Tj ET`);
  const page = (number, annots = '') => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 440 560]
/Resources << /Font << /F1 7 0 R >> >> /Contents ${number} 0 R ${annots} >>`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>',
    page(5, '/Annots [8 0 R]'), page(6),
    contents('0.15 0.34 0.76', 'Project brief', '01  /  Overview and deliverables'),
    contents(secondPageColor, 'Review notes', '02  /  Evidence and follow-up'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /Annot /Subtype /Link /Rect [28 418 280 440] /A << /S /URI /URI (${link}) >> >>`,
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, entry] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${entry}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return Buffer.from(`${pdf}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'ascii');
}
