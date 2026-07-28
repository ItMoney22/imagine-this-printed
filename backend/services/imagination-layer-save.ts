// backend/services/imagination-layer-save.ts
//
// Pure helpers for persisting Imagination Sheet layers (POST /projects/save)
// and for the server-side print-ready render (POST /sheets/:id/render).
// Kept dependency-free (no Supabase/GCS/AI client construction) so they can
// be unit tested directly — imagination-station.ts pulls in a lot of heavy
// side-effecting service modules, which would make importing it into a test
// fragile and slow.

// Matches imagination_layers.id (UUID PRIMARY KEY). Client-generated ids for
// text/shape layers created purely in the browser (e.g. `shape-<ts>`) are NOT
// valid UUIDs and must be inserted fresh rather than upserted by id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

// Shape of a layer as sent by the client to POST /projects/save.
export interface IncomingLayer {
  id?: string;
  layer_type?: string;
  source_url?: string | null;
  processed_url?: string | null;
  position_x?: number;
  position_y?: number;
  width?: number | null;
  height?: number | null;
  rotation?: number;
  scale_x?: number;
  scale_y?: number;
  z_index?: number;
  metadata?: Record<string, any> | null;
}

export function toLayerDbRow(l: IncomingLayer, sheetId: string) {
  return {
    sheet_id: sheetId,
    layer_type: l?.layer_type,
    source_url: l?.source_url ?? null,
    processed_url: l?.processed_url ?? null,
    position_x: l?.position_x ?? 0,
    position_y: l?.position_y ?? 0,
    width: l?.width ?? null,
    height: l?.height ?? null,
    rotation: l?.rotation ?? 0,
    scale_x: l?.scale_x ?? 1,
    scale_y: l?.scale_y ?? 1,
    z_index: l?.z_index ?? 0,
    metadata: l?.metadata ?? null,
  };
}

/**
 * Split incoming layers into rows to upsert-by-id (valid UUID — existing DB
 * row) vs. rows to insert fresh (client-generated placeholder id, e.g. a
 * text/shape layer created purely in the browser as `text-<ts>` — never a
 * real DB id). withoutIdClientIds is index-aligned with withoutIdRows so the
 * caller can map the DB-assigned id back to the client's placeholder id
 * after insert.
 */
export function partitionLayersForSave(layers: IncomingLayer[], sheetId: string) {
  const withId = layers.filter((l) => isUuid(l?.id));
  const withoutId = layers.filter((l) => !isUuid(l?.id));
  return {
    withIdRows: withId.map((l) => ({ id: l.id as string, ...toLayerDbRow(l, sheetId) })),
    withoutIdRows: withoutId.map((l) => toLayerDbRow(l, sheetId)),
    withoutIdClientIds: withoutId.map((l) => l.id),
  };
}

// Print-ready render resolution. Intentionally independent of the editor's
// on-screen PIXELS_PER_INCH (96, in SheetCanvas.tsx) — that constant is a
// screen-scale factor for the Konva stage and must stay small enough to be
// usable in a browser; the print file is always rendered at the print-type's
// promised DPI regardless of what the editor uses on screen.
export const RENDER_DPI = 300;

/**
 * Konva rotates a node around its own (x,y) origin (top-left corner, since no
 * offsetX/offsetY is set anywhere in SheetCanvas.tsx) — the Transformer just
 * back-solves x/y so it LOOKS like a center-pivot rotation while dragging,
 * but the stored (position_x, position_y, rotation) triple already encodes
 * the final on-canvas result. Given an unrotated widthPx x heightPx rect
 * whose top-left corner is (0,0), rotating it by angleDeg around that same
 * top-left corner sweeps out a new bounding box; this returns that bounding
 * box's top-left offset (relative to the original top-left) plus its size,
 * so a rotated layer can be composited at the correct canvas position.
 */
export function rotatedBoundingBox(widthPx: number, heightPx: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Rotate directly around (0,0) — the shape's own top-left corner — NOT
  // around the shape's center. Konva's default rotation pivot is the node's
  // local origin (offsetX/offsetY, which SheetCanvas.tsx never sets, so it's
  // (0,0) = the top-left corner), so this must match that pivot exactly.
  const corners: Array<[number, number]> = [[0, 0], [widthPx, 0], [0, heightPx], [widthPx, heightPx]];
  const rotated = corners.map(([x, y]) => {
    return [x * cos - y * sin, x * sin + y * cos] as [number, number];
  });

  const xs = rotated.map(p => p[0]);
  const ys = rotated.map(p => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return { offsetX: minX, offsetY: minY, width: maxX - minX, height: maxY - minY };
}
