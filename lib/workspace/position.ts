/**
 * Workspace Position — the addressable state of the workspace
 *
 * Every state a person can reach, another person can be sent to. This module
 * is the single definition of what "where I am" means, and the only place it
 * is encoded to or decoded from a URL.
 *
 * Why this exists: the workspace previously had no URL state at all. The
 * address was byte-identical for every region, selection, and lens, which
 * meant reload was a cold start, browser back/forward did nothing, and "Copy
 * share link" always sent the default overview no matter what the sender was
 * looking at. Understanding could not survive a closed tab or be handed to
 * anyone else.
 *
 * Values are treated as untrusted: a URL can be hand-edited or truncated, so
 * every field is validated and anything unrecognised is dropped rather than
 * carried into application state.
 *
 * @module lib/workspace/position
 */

/**
 * Lens values the workspace understands.
 *
 * Kept as a runtime array rather than only a type, because URL parsing needs
 * to check membership at runtime.
 *
 * 'dependencies' is currently unreachable from the interface but remains
 * valid: it still names a coherent thing to weight the map by, so a link
 * minted while it was offered continues to resolve.
 *
 * 'warnings' was removed rather than merely hidden. It bundled hubs,
 * unimported files, and cycles into one set under a word that called all three
 * faults — and two of the three frequently are not. There is nothing left for
 * it to resolve TO, so a stale `?lens=warnings` link degrades to no lens,
 * which is what parsePosition already does with any value it does not
 * recognise. Keeping it as an alias for its old behaviour would preserve
 * exactly the conflation this vocabulary was changed to remove.
 */
export const LENS_VALUES = [
  "cycles",
  "hubs",
  "orphans",
  "dependencies",
] as const;

export type LensValue = (typeof LENS_VALUES)[number];

/** Camera framing: world-space centre plus zoom. */
export type CameraPosition = {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
};

/**
 * Everything that constitutes "where I am" in the workspace.
 *
 * Deliberately does NOT include the trail. A trail is a record of one person's
 * path through an investigation; it grows without bound and belongs to a
 * session rather than to a location. Putting it in the address would make
 * every shared link carry someone else's history and grow until it broke.
 */
export type WorkspacePosition = {
  /** Expanded region, or null for the repository overview. */
  readonly region: string | null;
  /** Selected file path, or null. */
  readonly file: string | null;
  /** Selected declaration within the file, when one is focused. */
  readonly symbol?: string | null;
  /** Active observation lens, or null. */
  readonly lens: LensValue | null;
  /**
   * Camera framing, or null to let the map frame itself.
   *
   * Null is meaningfully different from a stored camera: it means "no opinion,
   * fit the content", which is what a first visit should get. A shared link
   * that pins the camera reproduces what the sender was actually looking at.
   */
  readonly camera: CameraPosition | null;
};

export const EMPTY_POSITION: WorkspacePosition = {
  region: null,
  file: null,
  symbol: null,
  lens: null,
  camera: null,
};

const PARAM = {
  region: "region",
  file: "file",
  symbol: "symbol",
  lens: "lens",
  camera: "cam",
} as const;

function parseLens(raw: string | null): LensValue | null {
  if (!raw) return null;
  return (LENS_VALUES as readonly string[]).includes(raw)
    ? (raw as LensValue)
    : null;
}

/**
 * Parse a camera from its "x,y,zoom" form.
 *
 * Returns null on anything malformed. A partially-parsed camera would frame
 * the map somewhere nobody chose, which is worse than not framing it at all.
 */
function parseCamera(raw: string | null): CameraPosition | null {
  if (!raw) return null;
  const parts = raw.split(",");
  if (parts.length !== 3) return null;
  const [x, y, zoom] = parts.map((part) => Number.parseFloat(part));
  if (![x, y, zoom].every(Number.isFinite)) return null;
  // A non-positive zoom is not recoverable — it would render nothing.
  if (zoom <= 0) return null;
  return { x, y, zoom };
}

/** Round to 2dp so panning does not produce absurdly long addresses. */
function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatCamera(camera: CameraPosition): string {
  return [
    roundCoord(camera.x),
    roundCoord(camera.y),
    Math.round(camera.zoom * 1000) / 1000,
  ].join(",");
}

/**
 * Read a position out of URL search params.
 *
 * `knownRegions` and `knownFiles` gate the region and file values. Without
 * that check a hand-edited or stale link could put the workspace into a state
 * referring to something that does not exist in this repository — and the
 * interface would have to either crash or silently show the wrong thing.
 * Unrecognised values are dropped, so a stale link degrades to the nearest
 * valid position rather than failing.
 */
export function parsePosition(
  params: URLSearchParams | null | undefined,
  knownRegions: ReadonlySet<string>,
  knownFiles: ReadonlySet<string>,
  symbolOwnerById: ReadonlyMap<string, string> = new Map(),
): WorkspacePosition {
  if (!params) return EMPTY_POSITION;

  const rawRegion = params.get(PARAM.region);
  const region = rawRegion && knownRegions.has(rawRegion) ? rawRegion : null;

  const rawFile = params.get(PARAM.file);
  let file = rawFile && knownFiles.has(rawFile) ? rawFile : null;

  // A selection outside the expanded region is not a position the interface
  // can render, so the weaker claim yields. This can only arise from an
  // edited or hand-built link.
  if (file && region && !file.startsWith(`${region}/`)) {
    const looksContained = file.includes("/") && region !== "other";
    if (looksContained) file = null;
  }

  const rawSymbol = params.get(PARAM.symbol);
  const symbol = file && rawSymbol && symbolOwnerById.get(rawSymbol) === file
    ? rawSymbol
    : null;

  return {
    region,
    file,
    symbol,
    lens: parseLens(params.get(PARAM.lens)),
    camera: parseCamera(params.get(PARAM.camera)),
  };
}

/**
 * Serialise a position to a search string, including the leading "?".
 *
 * Only non-default values are written. The overview with nothing selected has
 * an empty query, so the plain `/repo/:id` address keeps meaning exactly what
 * it always meant.
 */
export function serializePosition(position: WorkspacePosition): string {
  const params = new URLSearchParams();
  if (position.region) params.set(PARAM.region, position.region);
  if (position.file) params.set(PARAM.file, position.file);
  if (position.file && position.symbol) params.set(PARAM.symbol, position.symbol);
  if (position.lens) params.set(PARAM.lens, position.lens);
  if (position.camera) params.set(PARAM.camera, formatCamera(position.camera));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * Whether two positions denote the same place.
 *
 * Camera equality is compared on the rounded, serialised form so that
 * sub-pixel drift does not register as a move. Without that, a camera that
 * merely settled would look like navigation and pollute history.
 */
export function samePosition(
  a: WorkspacePosition,
  b: WorkspacePosition,
): boolean {
  if (
    a.region !== b.region ||
    a.file !== b.file ||
    (a.symbol ?? null) !== (b.symbol ?? null) ||
    a.lens !== b.lens
  ) {
    return false;
  }
  if (!a.camera && !b.camera) return true;
  if (!a.camera || !b.camera) return false;
  return formatCamera(a.camera) === formatCamera(b.camera);
}

/**
 * Whether the difference between two positions is a change of place rather
 * than a change of framing.
 *
 * Drives the choice between pushState and replaceState. Moving to another
 * region or file is a step in an investigation and belongs in history;
 * panning and zooming is adjusting your view of the step you are already on,
 * and filling history with it would make the back button useless.
 */
export function isNavigation(
  from: WorkspacePosition,
  to: WorkspacePosition,
): boolean {
  return (
    from.region !== to.region ||
    from.file !== to.file ||
    (from.symbol ?? null) !== (to.symbol ?? null) ||
    from.lens !== to.lens
  );
}
