import { buffer } from 'node:stream/consumers';
import { fromBufferPromise } from 'yauzl';

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** A stream's bytes as text. `Response.text()` would strip the BOM the export writes (RFC-66 R4). */
export async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return decoder.decode(await new Response(stream).arrayBuffer());
}

/** RFC 4180 line → fields (quotes doubled inside quoted fields). */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** One export CSV: BOM flag, the header line, and the data rows (the fixtures hold no line breaks). */
export function parseCsv(text: string): { bom: boolean; header: string; rows: string[][] } {
  const bom = text.startsWith('﻿');
  const lines = (bom ? text.slice(1) : text).split('\r\n');
  if (lines.at(-1) !== '') throw new Error('the CSV does not end with CRLF');
  return { bom, header: lines[0] ?? '', rows: lines.slice(1, -1).map(parseLine) };
}

/** Every entry of a ZIP, in archive order, as text with the BOM kept. */
export async function unzip(bytes: ArrayBuffer | Uint8Array): Promise<Map<string, string>> {
  const zip = await fromBufferPromise(Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
  const files = new Map<string, string>();
  for await (const entry of zip.eachEntry()) {
    files.set(entry.fileName, decoder.decode(await buffer(await zip.openReadStreamPromise(entry))));
  }
  return files;
}
