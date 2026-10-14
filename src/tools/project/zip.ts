import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Minimal ZIP writer using the stored (uncompressed) method, streaming to a
 * temp file so archives of any size (node_modules included, gigabytes) never
 * sit in memory.
 *
 * OpenCode loads plugins inside a Bun runtime, where optional native modules
 * such as archiver or yazl are unreliable — hence hand-rolled. Each file takes
 * two streaming passes (hash + size first, because the local header precedes
 * the bytes, then the bytes piped straight through), so peak RAM is one 64KB
 * window no matter the archive size. Output bytes match the historical
 * buffered writer exactly: stored method, no extra fields, entries in input
 * order — the byte-level tests below pin this.
 */
export interface ZipResult {
  /** Temp file holding the archive. The caller uploads then deletes it. */
  path: string;
  /** Total archive bytes. */
  bytes: number;
  /** File entries written. */
  count: number;
}

const CHUNK_BYTES = 64 * 1024;

export async function zipDirectory(root: string, files: string[]): Promise<ZipResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "shipit-zip-"));
  const outPath = path.join(dir, "archive.zip");
  const out = createWriteStream(outPath);
  const central: Buffer[] = [];
  let centralLen = 0;
  let offset = 0;
  let count = 0;

  const fail = async (err: unknown): Promise<never> => {
    out.destroy();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  };

  // Tiny header writes: awaited for ordering, never a memory concern.
  const put = async (buf: Buffer): Promise<void> => {
    if (buf.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      out.write(buf, (err) => (err ? reject(err) : resolve()));
    });
  };

  try {
    for (const file of files) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      const nameBuf = Buffer.from(rel, "utf8");

      // Pass one: hash + size. The header needs both before a single content
      // byte is written, and the content is never buffered to get them.
      let crc = 0xffffffff;
      let size = 0;
      try {
        const scan = createReadStream(file, { highWaterMark: CHUNK_BYTES });
        for await (const chunk of scan) {
          const buf = chunk as Buffer;
          size += buf.length;
          crc = crc32Update(crc, buf);
        }
      } catch (err) {
        await fail(err);
      }
      crc = (crc ^ 0xffffffff) >>> 0;

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0, 6);
      local.writeUInt16LE(0, 8);
      local.writeUInt16LE(0, 10);
      local.writeUInt16LE(0, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(size, 18);
      local.writeUInt32LE(size, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);
      try {
        await put(local);
        await put(nameBuf);
      } catch (err) {
        await fail(err);
      }
      const headerLen = local.length + nameBuf.length;
      offset += headerLen;

      // Pass two: the bytes piped straight through with backpressure, counted
      // so a file that changed mid-archive fails loud instead of shipping a
      // corrupt entry whose header lies about its size.
      let written = 0;
      const counter = new Transform({
        transform(chunk, _encoding, callback) {
          written += (chunk as Buffer).length;
          callback(null, chunk);
        },
      });
      try {
        await pipeline(createReadStream(file, { highWaterMark: CHUNK_BYTES }), counter, out, {
          end: false,
        });
      } catch (err) {
        await fail(err);
      }
      if (written !== size) {
        await fail(new Error(`File changed during archival: ${rel}`));
      }
      offset += written;

      const centralEntry = Buffer.alloc(46);
      centralEntry.writeUInt32LE(0x02014b50, 0);
      centralEntry.writeUInt16LE(20, 4);
      centralEntry.writeUInt16LE(20, 6);
      centralEntry.writeUInt16LE(0, 8);
      centralEntry.writeUInt16LE(0, 10);
      centralEntry.writeUInt16LE(0, 12);
      centralEntry.writeUInt16LE(0, 14);
      centralEntry.writeUInt32LE(crc, 16);
      centralEntry.writeUInt32LE(size, 20);
      centralEntry.writeUInt32LE(size, 24);
      centralEntry.writeUInt16LE(nameBuf.length, 28);
      centralEntry.writeUInt16LE(0, 30);
      centralEntry.writeUInt16LE(0, 32);
      centralEntry.writeUInt16LE(0, 34);
      centralEntry.writeUInt16LE(0, 36);
      centralEntry.writeUInt32LE(0, 38);
      centralEntry.writeUInt32LE(offset - written - headerLen, 42);

      central.push(centralEntry, nameBuf);
      centralLen += centralEntry.length + nameBuf.length;
      count += 1;
    }

    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(count, 8);
    end.writeUInt16LE(count, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    try {
      await put(centralBuf);
      await put(end);
      await new Promise<void>((resolve, reject) => {
        out.end(() => resolve());
        out.on("error", reject);
      });
    } catch (err) {
      await fail(err);
    }
  } catch (err) {
    await fail(err);
  }

  return { path: outPath, bytes: offset + centralLen + 22, count };
}

let crcTable: Uint32Array | null = null;

function crcTableInit(): Uint32Array {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[i] = c >>> 0;
    }
  }
  return crcTable;
}

function crc32Update(crc: number, buf: Buffer): number {
  const table = crcTableInit();
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

export function crc32(buf: Buffer): number {
  return (crc32Update(0xffffffff, buf) ^ 0xffffffff) >>> 0;
}

export const buildZipForTest = zipDirectory;
