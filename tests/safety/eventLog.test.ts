import test from "node:test";
import assert from "node:assert/strict";
import { SafetyEventLog, safetyEventToParseReason } from "../../lib/safety/eventLog";

test("SafetyEventLog - record and drain", () => {
  const log = new SafetyEventLog();
  assert.equal(log.length, 0);

  log.recordPathRejection("some/file.ts", "path escapes extraction root");
  log.recordContentUnreadable("another/file.ts", "binary");
  log.recordResourceExceeded("big/file.ts", "timeout");

  assert.equal(log.length, 3);

  const events = log.drain();
  assert.equal(events.length, 3);
  assert.equal(log.length, 0);

  assert.equal(events[0].type, "path-rejected");
  assert.equal(events[0].path, "some/file.ts");
  assert.match(events[0].detail, /path escapes extraction root/);

  assert.equal(events[1].type, "content-unreadable");
  assert.equal(events[1].path, "another/file.ts");
  
  assert.equal(events[2].type, "resource-exceeded");
  assert.equal(events[2].path, "big/file.ts");
});

test("SafetyEventLog - safetyEventToParseReason mapping", () => {
  assert.equal(safetyEventToParseReason("path-rejected"), "unreadable");
  assert.equal(safetyEventToParseReason("content-unreadable"), "unreadable");
  assert.equal(safetyEventToParseReason("resource-exceeded"), "timeout");
});
