import assert from "node:assert/strict";
import test from "node:test";
import { forgetOwnerToken, loadOwnerToken, ownerLink, saveOwnerToken, takeOwnerFragment } from "@/lib/workspace/ownerToken";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
class ThrowingStorage {
  getItem(): string | null { throw new Error("denied"); }
  setItem(): void { throw new Error("denied"); }
  removeItem(): void { throw new Error("denied"); }
}

test("tokens are stored per analysis and can be forgotten", () => {
  const storage = new MemoryStorage() as unknown as Storage;
  saveOwnerToken("a", "tok", storage);
  assert.equal(loadOwnerToken("a", storage), "tok");
  assert.equal(loadOwnerToken("b", storage), null);
  forgetOwnerToken("a", storage);
  assert.equal(loadOwnerToken("a", storage), null);
});

test("blocked storage never throws", () => {
  const storage = new ThrowingStorage() as unknown as Storage;
  assert.doesNotThrow(() => saveOwnerToken("a", "tok", storage));
  assert.equal(loadOwnerToken("a", storage), null);
});

test("owner links carry the token only in the fragment", () => {
  const link = ownerLink("https://c.test", "id-1", "abc_DEF-123");
  assert.equal(link, "https://c.test/repo/id-1#owner=abc_DEF-123");
  assert.equal(takeOwnerFragment("#owner=abc_DEF-123"), "abc_DEF-123");
  assert.equal(takeOwnerFragment("#owner=bad token!"), null);
  assert.equal(takeOwnerFragment(""), null);
});
