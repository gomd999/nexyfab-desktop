export function canonicalTextBytes(value) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  return Buffer.from(text.replace(/\r\n?/g, '\n'), 'utf8');
}
