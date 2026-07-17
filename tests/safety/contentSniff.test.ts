import test from "node:test";
import assert from "node:assert/strict";
import { sniffContent } from "../../lib/safety/contentSniff";

test("ContentSniff - Binary detection accuracy (Null bytes)", (t) => {
  const buf = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x77]); // "hello\0w"
  assert.equal(sniffContent(buf).readable, false);
  assert.equal(sniffContent(buf).reason, "binary");
});

test("ContentSniff - Binary detection accuracy (Non-printable ratio)", (t) => {
  const buf = Buffer.alloc(100, 0x20); // 100 spaces
  // add 11 non-printable chars
  for (let i = 0; i < 11; i++) buf[i] = 0x01;
  assert.equal(sniffContent(buf).readable, false);
  assert.equal(sniffContent(buf).reason, "binary");
  
  const bufSafe = Buffer.alloc(100, 0x20);
  for (let i = 0; i < 9; i++) bufSafe[i] = 0x01; // 9%
  assert.equal(sniffContent(bufSafe).readable, true);
});

test("ContentSniff - Invalid Encoding (UTF-8 Replacements)", (t) => {
  // Create a buffer with invalid utf-8 sequences
  const buf = Buffer.alloc(100, 0x20);
  for (let i = 0; i < 10; i++) buf[i] = 0xff; // Invalid utf-8 byte
  assert.equal(sniffContent(buf).readable, false);
  assert.equal(sniffContent(buf).reason, "invalid-encoding");
  
  // Boundary split - 3 invalid bytes should pass
  const bufSafe = Buffer.alloc(100, 0x20);
  for (let i = 0; i < 3; i++) bufSafe[i] = 0xff;
  assert.equal(sniffContent(bufSafe).readable, true);
});

test("ContentSniff - Unicode Source Files", (t) => {
  const buf = Buffer.from("const foo = '你好，世界'; console.log(foo);", "utf-8");
  assert.equal(sniffContent(buf).readable, true);
});

test("ContentSniff - Empty Files", (t) => {
  const buf = Buffer.from("");
  assert.equal(sniffContent(buf).readable, false);
  assert.equal(sniffContent(buf).reason, "empty");
});

test("ContentSniff - Very Small Files", (t) => {
  const buf = Buffer.from("a");
  assert.equal(sniffContent(buf).readable, true);
});

test("ContentSniff - Files with BOM", (t) => {
  const buf = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]), // UTF-8 BOM
    Buffer.from("const a = 1;", "utf-8")
  ]);
  assert.equal(sniffContent(buf).readable, true);
});

test("ContentSniff - False negatives on common binary formats", (t) => {
  // PNG Header
  const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // 0x89 is not valid utf-8, but it's only 1 char? No wait, textdecoder might convert.
  // Actually, non-printable count:
  // 0x89 (137) is printable (>= 0x20) ? Yes, it's > 0x20.
  // 0x50 (P)
  // 0x4E (N)
  // 0x47 (G)
  // 0x0D (CR) - allowed control char
  // 0x0A (LF) - allowed control char
  // 0x1A (SUB) - < 0x20, so non-printable! Count: 1
  // 0x0A (LF) - allowed
  // Wait, let's see what the sniffer says for PNG header
  // TextDecoder for 0x89 -> 1 invalid char.
  // Is it caught? Let's add null bytes to simulate a real PNG which has many nulls.
  const realPng = Buffer.concat([pngBuf, Buffer.alloc(20, 0x00)]);
  assert.equal(sniffContent(realPng).readable, false);
  assert.equal(sniffContent(realPng).reason, "binary");
});

test("ContentSniff - Minified JavaScript", (t) => {
  // Minified JS has no newlines, long lines, maybe some unicode. No control chars usually.
  const buf = Buffer.from("const a=1;const b=2;console.log(a+b);".repeat(100), "utf-8");
  assert.equal(sniffContent(buf).readable, true);
});
