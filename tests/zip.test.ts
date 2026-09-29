import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildZipForTest, crc32 } from "../src/tools/project/zip.js";

/**
 * The plugin writes ZIP archives by hand rather than depending on a native
 * module, because OpenCode loads plugins in a Bun runtime where optional native
 * dependencies are unreliable. These tests parse the produced bytes directly so
 * they run identically on every platform without shelling out to unzip.
 */
function parseZip(buf: Buffer): Array<{ name: string; crc: number; size: number; data: Buffer }> {
  const entries: Array<{ name: string; crc: number; size: number; data: Buffer }> = [];
  let offset = 0;

  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;

    const crc = buf.readUInt32LE(offset + 14);
    const size = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);

    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;

    entries.push({
      name: buf.subarray(nameStart, nameStart + nameLen).toString("utf8"),
      crc,
      size,
      data: buf.subarray(dataStart, dataStart + size),
    });

    offset = dataStart + size;
  }

  return entries;
}

describe("crc32", () => {
  it("matches known reference values", () => {
    expect(crc32(Buffer.from(""))).toBe(0);
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(crc32(Buffer.from("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
});

describe("zip archive builder", () => {
  it("writes a valid archive header and end record", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shipit-zip-"));
    try {
      const zip = await buildZipForTest(dir, []);
      expect(zip.subarray(0, 4).toString("hex")).toBe("504b0506");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records relative paths, sizes and CRCs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shipit-zip-"));
    try {
      await mkdir(path.join(dir, "src"), { recursive: true });
      await writeFile(path.join(dir, "package.json"), '{"name":"demo"}');
      await writeFile(path.join(dir, "src", "index.js"), "console.log(1)");

      const zip = await buildZipForTest(dir, [
        path.join(dir, "package.json"),
        path.join(dir, "src", "index.js"),
      ]);

      const entries = parseZip(zip);
      const byName = Object.fromEntries(entries.map((e) => [e.name, e]));

      expect(Object.keys(byName).sort()).toEqual(["package.json", "src/index.js"]);

      for (const entry of entries) {
        expect(entry.crc).toBe(crc32(entry.data));
        expect(entry.size).toBe(entry.data.length);
      }

      expect(byName["package.json"].data.toString("utf8")).toBe('{"name":"demo"}');
      expect(byName["src/index.js"].data.toString("utf8")).toBe("console.log(1)");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses forward slashes in stored paths regardless of platform", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shipit-zip-"));
    try {
      await mkdir(path.join(dir, "a", "b"), { recursive: true });
      const nested = path.join(dir, "a", "b", "c.txt");
      await writeFile(nested, "deep");

      const zip = await buildZipForTest(dir, [nested]);
      const [entry] = parseZip(zip);

      expect(entry.name).toBe("a/b/c.txt");
      expect(entry.name).not.toContain("\\");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round trips a file large enough to exceed one write", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shipit-zip-"));
    try {
      const payload = Buffer.alloc(300_000, 0x41);
      await writeFile(path.join(dir, "big.bin"), payload);

      const zip = await buildZipForTest(dir, [path.join(dir, "big.bin")]);
      const [entry] = parseZip(zip);

      expect(entry.size).toBe(payload.length);
      expect(entry.crc).toBe(crc32(payload));
      expect(entry.data.equals(payload)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves binary content exactly", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shipit-zip-"));
    try {
      const payload = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      await writeFile(path.join(dir, "bytes.bin"), payload);

      const zip = await buildZipForTest(dir, [path.join(dir, "bytes.bin")]);
      const [entry] = parseZip(zip);

      expect(entry.data.equals(payload)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the central directory consistent with the entries", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shipit-zip-"));
    try {
      await writeFile(path.join(dir, "one.txt"), "1");
      await writeFile(path.join(dir, "two.txt"), "22");

      const zip = await buildZipForTest(dir, [
        path.join(dir, "one.txt"),
        path.join(dir, "two.txt"),
      ]);

      // Locate the end of central directory record and read its counters.
      const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      expect(eocd).toBeGreaterThan(-1);

      const entryCount = zip.readUInt16LE(eocd + 10);
      const centralSize = zip.readUInt32LE(eocd + 12);
      const centralOffset = zip.readUInt32LE(eocd + 16);

      expect(entryCount).toBe(2);
      expect(centralOffset + centralSize).toBe(eocd);

      // Every central directory record must point at a real local header.
      // Records are variable length: 46 bytes plus the file name.
      let cursor = centralOffset;
      for (let i = 0; i < entryCount; i++) {
        if (zip.readUInt32LE(cursor) !== 0x02014b50) {
          throw new Error(`central record ${i} has a bad signature`);
        }

        const localOffset = zip.readUInt32LE(cursor + 42);
        if (localOffset >= centralOffset) {
          throw new Error(`central record ${i} points outside the local headers`);
        }
        if (zip.readUInt32LE(localOffset) !== 0x04034b50) {
          throw new Error(`central record ${i} points at a non local header`);
        }

        const nameLen = zip.readUInt16LE(cursor + 28);
        expect(nameLen).toBeGreaterThan(0);
        cursor += 46 + nameLen;
      }

      expect(cursor).toBe(centralOffset + centralSize);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a directory that no longer exists rather than emitting a broken archive", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shipit-zip-"));
    try {
      const missing = path.join(dir, "nope.txt");
      await expect(buildZipForTest(dir, [missing])).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("handles utf8 filenames", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shipit-zip-"));
    try {
      await writeFile(path.join(dir, "café.txt"), "ok");
      const zip = await buildZipForTest(dir, [path.join(dir, "café.txt")]);
      const [entry] = parseZip(zip);
      expect(entry.name).toBe("café.txt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
