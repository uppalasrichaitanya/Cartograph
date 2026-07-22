import assert from "node:assert/strict";
import test from "node:test";
import { ParserRegistry, ExtensionCollisionError, DuplicateParserError } from "@/lib/analysis/parsers/registry";
import type { LanguageParser, ParserInitContext, ParseFileInput, ResolvedSpecifier } from "@/lib/analysis/parsers/interface";
import type { RawExtraction } from "@/lib/analysis/ir/types";

// ---------------------------------------------------------------------------
// Minimal Fake Parser
// ---------------------------------------------------------------------------

/**
 * A synthetic "minimal fake parser" used to test the registry in isolation.
 * Per the approved implementation plan: "Registry works with a synthetic
 * 'minimal fake parser' (per spec: 'a synthetic minimal fake parser used
 * to test the registry in isolation')."
 *
 * Tracks lifecycle calls (initialize, dispose) so tests can assert
 * that the registry invokes them correctly and in the right order.
 */
function createFakeParser(overrides: Partial<LanguageParser> & { id: string } = { id: "fake" }): LanguageParser & {
  initializeCalls: ParserInitContext[];
  disposeCalls: number;
} {
  const tracker = {
    initializeCalls: [] as ParserInitContext[],
    disposeCalls: 0,
  };

  return {
    id: overrides.id ?? "fake",
    name: overrides.name ?? "Fake Parser",
    language: overrides.language ?? "typescript",
    extensions: overrides.extensions ?? ["fake"],
    capabilities: overrides.capabilities ?? ["imports"],

    canHandle(extension: string): boolean {
      return this.extensions.includes(extension);
    },

    async initialize(context: ParserInitContext): Promise<void> {
      tracker.initializeCalls.push(context);
    },

    parseFile(_file: ParseFileInput, _content: string): RawExtraction {
      return {
        path: _file.relativePath,
        lineCount: 1,
        internalImports: [],
        externalImports: [],
        parseErrors: [],
        capabilitiesUsed: ["imports"],
      };
    },

    resolveImport(specifier: string, _fromFile: ParseFileInput, _knownFiles: ReadonlyArray<ParseFileInput>): ResolvedSpecifier {
      return { resolved: null, raw: specifier };
    },

    dispose(): void {
      tracker.disposeCalls++;
    },

    // Expose tracking state
    get initializeCalls() { return tracker.initializeCalls; },
    get disposeCalls() { return tracker.disposeCalls; },
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

test("ParserRegistry — register and retrieve", async (t) => {
  await t.test("register a parser → retrieve by extension", () => {
    const registry = new ParserRegistry();
    const parser = createFakeParser({ id: "test-lang", extensions: ["tl", "tlx"] });
    registry.register(parser);

    const found = registry.getParserForExtension("tl");
    assert.equal(found, parser);
    const found2 = registry.getParserForExtension("tlx");
    assert.equal(found2, parser);
  });

  await t.test("unknown extension → returns null", () => {
    const registry = new ParserRegistry();
    const parser = createFakeParser({ id: "test-lang", extensions: ["tl"] });
    registry.register(parser);

    assert.equal(registry.getParserForExtension("unknown"), null);
    assert.equal(registry.getParserForExtension("py"), null);
  });

  await t.test("extension lookup is case-insensitive", () => {
    const registry = new ParserRegistry();
    const parser = createFakeParser({ id: "test-lang", extensions: ["ts"] });
    registry.register(parser);

    assert.equal(registry.getParserForExtension("TS"), parser);
    assert.equal(registry.getParserForExtension("Ts"), parser);
    assert.equal(registry.getParserForExtension("ts"), parser);
  });

  await t.test("empty registry → returns null for any extension", () => {
    const registry = new ParserRegistry();
    assert.equal(registry.getParserForExtension("ts"), null);
    assert.equal(registry.getParserForExtension(""), null);
  });

  await t.test("multiple parsers for different extensions", () => {
    const registry = new ParserRegistry();
    const parserA = createFakeParser({ id: "lang-a", extensions: ["a"] });
    const parserB = createFakeParser({ id: "lang-b", extensions: ["b"] });
    registry.register(parserA);
    registry.register(parserB);

    assert.equal(registry.getParserForExtension("a"), parserA);
    assert.equal(registry.getParserForExtension("b"), parserB);
  });
});

// ---------------------------------------------------------------------------
// Extension Collision Detection
// ---------------------------------------------------------------------------

test("ParserRegistry — extension collision detection", async (t) => {
  await t.test("extension collision → throws ExtensionCollisionError at registration", () => {
    const registry = new ParserRegistry();
    const parserA = createFakeParser({ id: "lang-a", extensions: ["ts", "tsx"] });
    const parserB = createFakeParser({ id: "lang-b", extensions: ["ts"] });
    registry.register(parserA);

    assert.throws(
      () => registry.register(parserB),
      (err: unknown) => {
        assert.ok(err instanceof ExtensionCollisionError);
        assert.equal(err.extension, "ts");
        assert.equal(err.existingParserId, "lang-a");
        assert.equal(err.newParserId, "lang-b");
        return true;
      },
    );
  });

  await t.test("collision check is atomic — no partial registration", () => {
    const registry = new ParserRegistry();
    const parserA = createFakeParser({ id: "lang-a", extensions: ["ts"] });
    // parserB claims both "jsx" (new) and "ts" (collision)
    const parserB = createFakeParser({ id: "lang-b", extensions: ["jsx", "ts"] });
    registry.register(parserA);

    // Should throw because "ts" collides — but "jsx" should NOT be registered
    assert.throws(() => registry.register(parserB), ExtensionCollisionError);

    // Verify "jsx" was NOT partially registered
    assert.equal(registry.getParserForExtension("jsx"), null);
    // Original "ts" mapping still intact
    assert.equal(registry.getParserForExtension("ts"), parserA);
  });

  await t.test("duplicate parser id → throws DuplicateParserError", () => {
    const registry = new ParserRegistry();
    const parser1 = createFakeParser({ id: "same-id", extensions: ["a"] });
    const parser2 = createFakeParser({ id: "same-id", extensions: ["b"] });
    registry.register(parser1);

    assert.throws(
      () => registry.register(parser2),
      (err: unknown) => {
        assert.ok(err instanceof DuplicateParserError);
        assert.equal(err.parserId, "same-id");
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// getRegisteredExtensions
// ---------------------------------------------------------------------------

test("ParserRegistry — getRegisteredExtensions", async (t) => {
  await t.test("returns all registered extensions", () => {
    const registry = new ParserRegistry();
    const parser = createFakeParser({ id: "ts", extensions: ["ts", "tsx", "js", "jsx"] });
    registry.register(parser);

    const extensions = registry.getRegisteredExtensions();
    assert.equal(extensions.size, 4);
    assert.ok(extensions.has("ts"));
    assert.ok(extensions.has("tsx"));
    assert.ok(extensions.has("js"));
    assert.ok(extensions.has("jsx"));
  });

  await t.test("empty registry → empty set", () => {
    const registry = new ParserRegistry();
    const extensions = registry.getRegisteredExtensions();
    assert.equal(extensions.size, 0);
  });

  await t.test("multiple parsers → combined extensions", () => {
    const registry = new ParserRegistry();
    registry.register(createFakeParser({ id: "ts", extensions: ["ts", "tsx"] }));
    registry.register(createFakeParser({ id: "py", extensions: ["py"] }));

    const extensions = registry.getRegisteredExtensions();
    assert.equal(extensions.size, 3);
    assert.ok(extensions.has("ts"));
    assert.ok(extensions.has("tsx"));
    assert.ok(extensions.has("py"));
  });

  await t.test("returned set is read-only snapshot", () => {
    const registry = new ParserRegistry();
    registry.register(createFakeParser({ id: "ts", extensions: ["ts"] }));
    const extensions = registry.getRegisteredExtensions();

    // Registering more parsers doesn't change the previously returned set
    registry.register(createFakeParser({ id: "py", extensions: ["py"] }));
    assert.equal(extensions.size, 1); // snapshot unchanged
  });
});

// ---------------------------------------------------------------------------
// Lifecycle — initializeAll
// ---------------------------------------------------------------------------

test("ParserRegistry — initializeAll", async (t) => {
  await t.test("calls initialize() on every registered parser", async () => {
    const registry = new ParserRegistry();
    const parserA = createFakeParser({ id: "lang-a", extensions: ["a"] });
    const parserB = createFakeParser({ id: "lang-b", extensions: ["b"] });
    registry.register(parserA);
    registry.register(parserB);

    const context: ParserInitContext = {
      projectRoot: "/test/project",
      discoveredFiles: [],
    };

    await registry.initializeAll(context);

    assert.equal(parserA.initializeCalls.length, 1);
    assert.equal(parserB.initializeCalls.length, 1);
    assert.deepEqual(parserA.initializeCalls[0], context);
    assert.deepEqual(parserB.initializeCalls[0], context);
  });

  await t.test("parsers are initialized in registration order", async () => {
    const registry = new ParserRegistry();
    const order: string[] = [];

    const parserA = createFakeParser({ id: "first", extensions: ["a"] });
    const parserB = createFakeParser({ id: "second", extensions: ["b"] });

    // Override initialize to track call order
    const origInitA = parserA.initialize.bind(parserA);
    parserA.initialize = async (ctx) => {
      order.push("first");
      return origInitA(ctx);
    };
    const origInitB = parserB.initialize.bind(parserB);
    parserB.initialize = async (ctx) => {
      order.push("second");
      return origInitB(ctx);
    };

    registry.register(parserA);
    registry.register(parserB);

    await registry.initializeAll({ projectRoot: "/test", discoveredFiles: [] });

    assert.deepEqual(order, ["first", "second"]);
  });

  await t.test("initialize error propagates immediately", async () => {
    const registry = new ParserRegistry();
    const parser = createFakeParser({ id: "broken", extensions: ["brk"] });
    parser.initialize = async () => {
      throw new Error("Config file not found");
    };
    registry.register(parser);

    await assert.rejects(
      () => registry.initializeAll({ projectRoot: "/test", discoveredFiles: [] }),
      { message: "Config file not found" },
    );
  });

  await t.test("empty registry → initializeAll succeeds (no-op)", async () => {
    const registry = new ParserRegistry();
    // Should not throw
    await registry.initializeAll({ projectRoot: "/test", discoveredFiles: [] });
  });
});

// ---------------------------------------------------------------------------
// Lifecycle — disposeAll
// ---------------------------------------------------------------------------

test("ParserRegistry — disposeAll", async (t) => {
  await t.test("calls dispose() on every registered parser", () => {
    const registry = new ParserRegistry();
    const parserA = createFakeParser({ id: "lang-a", extensions: ["a"] });
    const parserB = createFakeParser({ id: "lang-b", extensions: ["b"] });
    registry.register(parserA);
    registry.register(parserB);

    registry.disposeAll();

    assert.equal(parserA.disposeCalls, 1);
    assert.equal(parserB.disposeCalls, 1);
  });

  await t.test("disposeAll swallows errors from individual parsers", () => {
    const registry = new ParserRegistry();
    const parserA = createFakeParser({ id: "throws", extensions: ["a"] });
    const parserB = createFakeParser({ id: "ok", extensions: ["b"] });
    parserA.dispose = () => {
      throw new Error("cleanup failed");
    };
    registry.register(parserA);
    registry.register(parserB);

    // Should not throw — errors are silently swallowed
    assert.doesNotThrow(() => registry.disposeAll());
    // parserB should still have been disposed
    assert.equal(parserB.disposeCalls, 1);
  });

  await t.test("parsers are disposed in registration order", () => {
    const registry = new ParserRegistry();
    const order: string[] = [];

    const parserA = createFakeParser({ id: "first", extensions: ["a"] });
    const parserB = createFakeParser({ id: "second", extensions: ["b"] });
    parserA.dispose = () => { order.push("first"); };
    parserB.dispose = () => { order.push("second"); };

    registry.register(parserA);
    registry.register(parserB);
    registry.disposeAll();

    assert.deepEqual(order, ["first", "second"]);
  });

  await t.test("empty registry → disposeAll succeeds (no-op)", () => {
    const registry = new ParserRegistry();
    assert.doesNotThrow(() => registry.disposeAll());
  });
});
