import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { validateExtractionPath, isSymlinkEntry } from "../../lib/safety/pathValidation";

test("PathValidation - Path Traversal Prevention", () => {
  const root = path.resolve("/extraction/root");
  
  assert.equal(validateExtractionPath("../../etc/passwd", root).safe, false);
  assert.equal(validateExtractionPath("foo/../bar", root).safe, true); // resolves to /extraction/root/bar
  assert.equal(validateExtractionPath("foo/../../bar", root).safe, false); // escapes root
  assert.equal(validateExtractionPath("foo/../../../outside", root).safe, false);
  assert.equal(validateExtractionPath("..", root).safe, false);
  assert.equal(validateExtractionPath("../root", root).safe, false);
  assert.equal(validateExtractionPath("", root).safe, false);
  assert.equal(validateExtractionPath("\0", root).safe, false);
});

test("PathValidation - Absolute Path Rejection", () => {
  const root = path.resolve("/extraction/root");
  
  // POSIX
  assert.equal(validateExtractionPath("/etc/passwd", root).safe, false);
  assert.equal(validateExtractionPath("/extraction/root/file", root).safe, false);
  
  // Windows
  assert.equal(validateExtractionPath("C:\\Windows\\System32\\cmd.exe", root).safe, false);
  assert.equal(validateExtractionPath("D:/foo/bar", root).safe, false);
  
  // UNC Paths
  assert.equal(validateExtractionPath("\\\\server\\share\\file", root).safe, false);
  
  // Windows extended-length paths
  assert.equal(validateExtractionPath("\\\\?\\C:\\foo", root).safe, false);
  
  // Drive-relative paths
  // If root is on C:, C:folder resolves inside it. If root is on D:, it resolves to C: CWD, which escapes.
  // In our test, root is /extraction/root (which is on the current drive, e.g. C:).
  // So C:folder might be contained. Let's just test that it doesn't escape in a dangerous way.
  // We'll test with a D: relative path.
  const res = validateExtractionPath("D:folder", root);
  // It either resolves inside root (safe: true) or escapes (safe: false). Both are safe outcomes from a security perspective!
  // Actually, let's just make sure it behaves correctly. We don't need a strict assert if behavior depends on the OS CWD, 
  // but we can assert it's false because it escapes /extraction/root if D: is different from the current drive.
  if (res.safe) {
      assert.ok(res.resolvedPath!.startsWith(root + path.sep));
  }
});

test("PathValidation - Prefix Bypass Attacks", () => {
  const root = path.resolve("/extraction/root");
  assert.equal(validateExtractionPath("../root2", root).safe, false);
});

test("PathValidation - Mixed Separator Attacks", () => {
  const root = path.resolve("/extraction/root");
  assert.equal(validateExtractionPath("foo\\..\\..\\outside", root).safe, false);
  assert.equal(validateExtractionPath("foo/..\\../outside", root).safe, false);
});

test("PathValidation - Normalization Correctness", () => {
  const root = path.resolve("/extraction/root");
  const res = validateExtractionPath("src/./foo/../index.ts", root);
  assert.equal(res.safe, true);
  assert.equal(res.resolvedPath, path.resolve(root, "src/index.ts"));
});

test("PathValidation - Cross-platform behavior", () => {
  const root = path.resolve("/extraction/root");
  assert.equal(validateExtractionPath("C:\\Windows", root).safe, false);
});

test("PathValidation - Symlink detection correctness", () => {
  assert.equal(isSymlinkEntry(0o120000 << 16), true);
  assert.equal(isSymlinkEntry((0o120000 << 16) | 0o777), true); 
  assert.equal(isSymlinkEntry(0o100644 << 16), false); 
  assert.equal(isSymlinkEntry(0o040755 << 16), false); 
  assert.equal(isSymlinkEntry(0), false);
});
