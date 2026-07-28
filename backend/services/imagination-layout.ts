// backend/services/imagination-layout.ts
// Auto-layout algorithms for Imagination Sheet™ optimization

// Physical trim/safe zone every DTF sheet is printed with — rendered client-side
// as the dashed rectangle in SheetCanvas.tsx ("Safe Margin - 0.25\" from edge").
// Auto-Nest must never place a layer's outer edge inside this zone, regardless
// of whatever (smaller) `padding` a caller passes for gaps between items.
const SAFE_MARGIN_IN = 0.25;

interface LayerDimensions {
  id: string;
  width: number;
  height: number;
  // Real position on the sheet, in inches. Required for Smart Fill to detect
  // collisions against where a layer actually sits — without these it can
  // only assume every layer is anchored at the origin (see smartFill below).
  position_x?: number;
  position_y?: number;
  rotation?: number;
  // Smart Fill only: false marks a layer that exists on the sheet (and must
  // still be avoided for collisions) but was NOT selected by the user as a
  // duplication source. Defaults to true so Auto-Nest payloads (which never
  // set this) and any older caller keep treating every layer as fair game to
  // pick a template from.
  isTemplateCandidate?: boolean;
}

interface Position {
  id: string;
  x: number;
  y: number;
  rotation?: number;
}

interface AutoNestResult {
  positions: Position[];
  // Ids of layers that could not be placed anywhere on the sheet. These are
  // NOT stacked at the origin (that used to overlap whatever else landed
  // there and inflate the efficiency number with phantom area) — callers are
  // expected to leave them at their existing position and tell the user.
  unplaced: string[];
  efficiency: number;
  wastedSpace: number;
}

interface SmartFillResult {
  duplicates: Array<{
    sourceId: string;
    x: number;
    y: number;
    rotation?: number;
  }>;
  coverage: number;
  totalAdded: number;
}

/**
 * Grid-based packing algorithm for Auto-Nest
 * Uses a simple shelf-packing approach with rotation support
 */
export function autoNest(
  sheetWidth: number,
  sheetHeight: number,
  layers: LayerDimensions[],
  padding: number = 0.125
): AutoNestResult {
  if (!layers.length) {
    return { positions: [], unplaced: [], efficiency: 0, wastedSpace: sheetWidth * sheetHeight };
  }

  // Edge-adjacent bounds always respect the physical safe margin, even if a
  // caller passes a smaller `padding` for gaps between items. `padding` still
  // controls item-to-item spacing (shelf gaps, x-advance within a shelf).
  const edgeMargin = Math.max(padding, SAFE_MARGIN_IN);

  // Sort layers by area (largest first) for better packing
  const sortedLayers = [...layers].sort((a, b) => {
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    return areaB - areaA;
  });

  const positions: Position[] = [];
  const unplaced: string[] = [];
  const shelves: Array<{ y: number; height: number; currentX: number }> = [];
  let currentShelf = { y: edgeMargin, height: 0, currentX: edgeMargin };
  shelves.push(currentShelf);

  for (const layer of sortedLayers) {
    let placed = false;
    let bestFit: { x: number; y: number; rotation?: number; shelfIndex: number } | null = null;

    // Try to place in existing shelves first
    for (let i = 0; i < shelves.length; i++) {
      const shelf = shelves[i];

      // Try without rotation
      if (
        shelf.currentX + layer.width + edgeMargin <= sheetWidth &&
        shelf.y + Math.max(shelf.height, layer.height) + edgeMargin <= sheetHeight
      ) {
        bestFit = {
          x: shelf.currentX,
          y: shelf.y,
          rotation: 0,
          shelfIndex: i
        };
        break;
      }

      // Try with 90-degree rotation
      const rotatedWidth = layer.height;
      const rotatedHeight = layer.width;
      if (
        shelf.currentX + rotatedWidth + edgeMargin <= sheetWidth &&
        shelf.y + Math.max(shelf.height, rotatedHeight) + edgeMargin <= sheetHeight
      ) {
        bestFit = {
          x: shelf.currentX,
          y: shelf.y,
          rotation: 90,
          shelfIndex: i
        };
        break;
      }
    }

    // If no existing shelf works, try creating a new shelf
    if (!bestFit) {
      const lastShelf = shelves[shelves.length - 1];
      const newShelfY = lastShelf.y + lastShelf.height + padding;

      // Try without rotation on new shelf
      if (
        edgeMargin + layer.width + edgeMargin <= sheetWidth &&
        newShelfY + layer.height + edgeMargin <= sheetHeight
      ) {
        const newShelf = { y: newShelfY, height: layer.height, currentX: edgeMargin };
        shelves.push(newShelf);
        bestFit = {
          x: edgeMargin,
          y: newShelfY,
          rotation: 0,
          shelfIndex: shelves.length - 1
        };
      }
      // Try with rotation on new shelf
      else if (
        edgeMargin + layer.height + edgeMargin <= sheetWidth &&
        newShelfY + layer.width + edgeMargin <= sheetHeight
      ) {
        const newShelf = { y: newShelfY, height: layer.width, currentX: edgeMargin };
        shelves.push(newShelf);
        bestFit = {
          x: edgeMargin,
          y: newShelfY,
          rotation: 90,
          shelfIndex: shelves.length - 1
        };
      }
    }

    if (bestFit) {
      const shelf = shelves[bestFit.shelfIndex];
      const itemWidth = bestFit.rotation === 90 ? layer.height : layer.width;
      const itemHeight = bestFit.rotation === 90 ? layer.width : layer.height;

      positions.push({
        id: layer.id,
        x: bestFit.x,
        y: bestFit.y,
        rotation: bestFit.rotation || layer.rotation || 0
      });

      // Update shelf state
      shelf.currentX = bestFit.x + itemWidth + padding;
      shelf.height = Math.max(shelf.height, itemHeight);
      placed = true;
    } else {
      // Doesn't fit anywhere on the sheet — report it instead of silently
      // stacking it at the origin (that used to overlap whatever else landed
      // there and inflate the efficiency number below with phantom area that
      // was never actually placed).
      console.warn(`Layer ${layer.id} could not be placed by Auto-Nest — sheet is full or the layer is too large`);
      unplaced.push(layer.id);
    }
  }

  // Calculate packing efficiency from PLACED layers only. Unplaced layers
  // contribute no area — they aren't on the sheet — so this can never exceed
  // the sheet area (placed layers don't overlap by construction) and the
  // Math.min(100, ...) is a defensive clamp, not a correction for real overage.
  const placedIds = new Set(positions.map(p => p.id));
  const placedArea = layers
    .filter(l => placedIds.has(l.id))
    .reduce((sum, l) => sum + (l.width * l.height), 0);
  const sheetArea = sheetWidth * sheetHeight;
  const efficiency = sheetArea > 0 ? Math.min(100, Math.round((placedArea / sheetArea) * 100)) : 0;
  const wastedSpace = Math.max(0, sheetArea - placedArea);

  return {
    positions,
    unplaced,
    efficiency,
    wastedSpace
  };
}

/**
 * Smart Fill algorithm - fills empty space with duplicates of selected designs
 * Uses a grid-based approach to maximize coverage
 */
export function smartFill(
  sheetWidth: number,
  sheetHeight: number,
  layers: LayerDimensions[],
  padding: number = 0.125
): SmartFillResult {
  if (!layers.length) {
    return { duplicates: [], coverage: 0, totalAdded: 0 };
  }

  // Template comes from the layers the caller marked as selected
  // (isTemplateCandidate !== false). `layers` itself always holds every layer
  // on the sheet — selected or not — because ALL of them must be checked for
  // collisions below; only candidacy for "what do we duplicate" narrows.
  const templateCandidates = layers.filter(l => l.isTemplateCandidate !== false);
  const candidatePool = templateCandidates.length ? templateCandidates : layers;

  // Use the first/smallest layer as the template to duplicate
  const template = candidatePool.reduce((smallest, current) => {
    const smallestArea = smallest.width * smallest.height;
    const currentArea = current.width * current.height;
    return currentArea < smallestArea ? current : smallest;
  }, candidatePool[0]);

  const duplicates: Array<{ sourceId: string; x: number; y: number; rotation?: number }> = [];

  // Calculate grid dimensions
  const itemWidth = template.width + padding * 2;
  const itemHeight = template.height + padding * 2;

  const cols = Math.floor(sheetWidth / itemWidth);
  const rows = Math.floor(sheetHeight / itemHeight);

  if (cols === 0 || rows === 0) {
    return { duplicates: [], coverage: 0, totalAdded: 0 };
  }

  // Create grid of duplicates
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = padding + col * itemWidth;
      const y = padding + row * itemHeight;

      // Check if this position would overlap with existing layers. Uses each
      // existing layer's TRUE position (position_x/position_y default to 0
      // only when a caller genuinely omits them) and a rotation-aware AABB —
      // previously this compared against {0,0,width,height} for every layer
      // regardless of where it actually sat, so it excluded a phantom
      // top-left block and then tiled duplicates over real artwork anywhere
      // else on the sheet.
      const newLeft = x;
      const newTop = y;
      const newRight = x + template.width;
      const newBottom = y + template.height;

      const overlaps = layers.some(existing => {
        const bounds = axisAlignedBounds(existing);
        return !(
          newRight <= bounds.left ||
          newLeft >= bounds.right ||
          newBottom <= bounds.top ||
          newTop >= bounds.bottom
        );
      });

      if (!overlaps) {
        duplicates.push({
          sourceId: template.id,
          x,
          y,
          rotation: 0
        });
      }
    }
  }

  // Calculate coverage using each EXISTING layer's own real area (not the
  // template's) plus the added duplicates, which are always template-sized.
  // The old formula multiplied (layers.length + duplicates.length) by the
  // template's area alone, so a sheet with a handful of large hero designs
  // and one small template layer wildly under- or over-reported coverage —
  // and by extension the price charged for a "ruined" gang sheet.
  const existingArea = layers.reduce((sum, l) => sum + l.width * l.height, 0);
  const duplicateArea = duplicates.length * (template.width * template.height);
  const filledArea = existingArea + duplicateArea;
  const sheetArea = sheetWidth * sheetHeight;
  const coverage = sheetArea > 0 ? Math.min(100, Math.round((filledArea / sheetArea) * 100)) : 0;

  return {
    duplicates,
    coverage,
    totalAdded: duplicates.length
  };
}

// Rotation-aware axis-aligned bounding box for a layer at its real position.
// For a 0/180deg rotation this is just {x,y,width,height}; for 90/270 it's the
// swapped width/height; for any other angle it's the standard AABB-of-a-
// rotated-rectangle formula so collision checks stay correct even if a layer
// was rotated to an arbitrary angle.
function axisAlignedBounds(layer: LayerDimensions): { left: number; top: number; right: number; bottom: number } {
  const x = layer.position_x ?? 0;
  const y = layer.position_y ?? 0;
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180;
  const w = Math.abs(layer.width * Math.cos(rad)) + Math.abs(layer.height * Math.sin(rad));
  const h = Math.abs(layer.width * Math.sin(rad)) + Math.abs(layer.height * Math.cos(rad));
  return { left: x, top: y, right: x + w, bottom: y + h };
}

/**
 * Layout service with pricing integration
 */
export const layoutService = {
  /**
   * Auto-nest layers on a sheet with pricing check
   */
  async autoNestWithPricing(
    userId: string,
    sheetId: string,
    sheetWidth: number,
    sheetHeight: number,
    layers: LayerDimensions[],
    padding: number,
    itcBalance: number
  ): Promise<AutoNestResult & { itcCharged: number }> {
    // Import pricing service (avoiding circular dependency)
    const { pricingService } = await import('./imagination-pricing');

    // Check pricing
    const pricing = await pricingService.getPricing('auto_nest');
    const freeTrial = await pricingService.getFreeTrial(userId, 'auto_nest');

    let itcCharged = 0;

    if (freeTrial && freeTrial.uses_remaining > 0) {
      // Use free trial
      await pricingService.consumeFreeTrial(userId, 'auto_nest');
    } else {
      // Check ITC balance
      const cost = pricing?.current_cost || 5;
      if (itcBalance < cost) {
        throw new Error('Insufficient ITC balance for Auto-Nest');
      }
      itcCharged = cost;

      // Charge will be handled by the route handler to ensure atomicity
    }

    // Perform auto-nest
    const result = autoNest(sheetWidth, sheetHeight, layers, padding);

    return {
      ...result,
      itcCharged
    };
  },

  /**
   * Smart fill with pricing check
   */
  async smartFillWithPricing(
    userId: string,
    sheetId: string,
    sheetWidth: number,
    sheetHeight: number,
    layers: LayerDimensions[],
    padding: number,
    itcBalance: number
  ): Promise<SmartFillResult & { itcCharged: number }> {
    // Import pricing service
    const { pricingService } = await import('./imagination-pricing');

    // Check pricing
    const pricing = await pricingService.getPricing('smart_fill');
    const freeTrial = await pricingService.getFreeTrial(userId, 'smart_fill');

    let itcCharged = 0;

    if (freeTrial && freeTrial.uses_remaining > 0) {
      // Use free trial
      await pricingService.consumeFreeTrial(userId, 'smart_fill');
    } else {
      // Check ITC balance
      const cost = pricing?.current_cost || 3;
      if (itcBalance < cost) {
        throw new Error('Insufficient ITC balance for Smart Fill');
      }
      itcCharged = cost;
    }

    // Perform smart fill
    const result = smartFill(sheetWidth, sheetHeight, layers, padding);

    return {
      ...result,
      itcCharged
    };
  }
};
