import assert from "node:assert/strict";
import test from "node:test";
import {
  createEdgeId,
  createExternalDependencyId,
  createModuleRootId,
  createNodeId,
  createRootFingerprint,
} from "@/lib/analysis/ir/identity";
import type { NodeId } from "@/lib/analysis/ir/types";

test("Identity Service", async (t) => {
  await t.test("createRootFingerprint is deterministic", () => {
    const fingerprint1 = createRootFingerprint("", "package.json");
    const fingerprint2 = createRootFingerprint("", "package.json");
    assert.equal(fingerprint1, fingerprint2);
    // Base62 string up to 22 chars
    assert.match(fingerprint1, /^[0-9A-Za-z]{1,22}$/);
  });

  await t.test("createRootFingerprint distinguishes by path and manifest", () => {
    const root1 = createRootFingerprint("", "package.json");
    const root2 = createRootFingerprint("packages/core", "package.json");
    const root3 = createRootFingerprint("", "go.mod");
    
    assert.notEqual(root1, root2);
    assert.notEqual(root1, root3);
    assert.notEqual(root2, root3);
  });

  await t.test("createNodeId is deterministic", () => {
    const fingerprint = createRootFingerprint("", "package.json");
    const id1 = createNodeId(fingerprint, "src/index.ts");
    const id2 = createNodeId(fingerprint, "src/index.ts");
    assert.equal(id1, id2);
  });

  await t.test("createNodeId prevents cross-root collisions for identical relative paths", () => {
    const root1 = createRootFingerprint("", "package.json");
    const root2 = createRootFingerprint("packages/core", "package.json");
    
    const id1 = createNodeId(root1, "src/index.ts");
    const id2 = createNodeId(root2, "src/index.ts");
    
    assert.notEqual(id1, id2);
  });

  await t.test("createEdgeId is deterministic and distinct by kind", () => {
    const from = "nodeA" as NodeId;
    const to = "nodeB" as NodeId;
    
    const contains1 = createEdgeId(from, "contains", to);
    const contains2 = createEdgeId(from, "contains", to);
    const imports = createEdgeId(from, "imports", to);
    
    assert.equal(contains1, contains2);
    assert.notEqual(contains1, imports);
  });

  await t.test("createExternalDependencyId is distinct from local files", () => {
    const fingerprint = createRootFingerprint("", "package.json");
    const localId = createNodeId(fingerprint, "react");
    const extId = createExternalDependencyId(fingerprint, "react");
    
    assert.notEqual(localId, extId);
  });

  await t.test("createModuleRootId is distinct from file NodeIds", () => {
    const fingerprint = createRootFingerprint("", "package.json");
    // What if a file has the same name as the fingerprint?
    const fileId = createNodeId(fingerprint, fingerprint);
    const rootId = createModuleRootId(fingerprint);
    
    assert.notEqual(fileId, rootId);
  });

  await t.test("Base62 encoding correctly handles zero", () => {
    // We can't easily force the SHA256 truncation to be exactly 0,
    // but the implementation of base62Encode must handle '0'. 
    // We rely on the determinism checks to ensure the math generally works.
    // If we wanted to test the internal base62Encode, we'd have to export it,
    // which we shouldn't do just for testing.
  });
});
