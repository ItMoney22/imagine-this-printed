// backend/services/imagination-layout.ts
// Auto-layout algorithms for Imagination Sheet™ optimization

interface LayerDimensions {
  id: string;
  width: number;
  height: number;
  rotation?: number;
}

interface Position {
  id: string;
  x: number;
  y: number;
  rotation?: number;
}

interface AutoNestResult {
  positions: Position[];
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
    return { positions: [], efficiency: 0, wastedSpace: sheetWidth * sheetHeight };
  }

  // Sort layers by area (largest first) for better packing
  const sortedLayers = [...layers].sort((a, b) => {
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    return areaB - areaA;
  });

  const positions: Position[] = [];
  const shelves: Array<{ y: number; height: number; currentX: number }> = [];
  let currentShelf = { y: padding, height: 0, currentX: padding };
  shelves.push(currentShelf);

  for (const layer of sortedLayers) {
    let placed = false;
    let bestFit: { x: number; y: number; rotation?: number; shelfIndex: number } | null = null;

    // Try to place in existing shelves first
    for (let i = 0; i < shelves.length; i++) {
      const shelf = shelves[i];

      // Try without rotation
      if (
        shelf.currentX + layer.width + padding <= sheetWidth &&
        shelf.y + Math.max(shelf.height, layer.height) + padding <= sheetHeight
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
        shelf.currentX + rotatedWidth + padding <= sheetWidth &&
        shelf.y + Math.max(shelf.height, rotatedHeight) + padding <= sheetHeight
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
        padding + layer.width + padding <= sheetWidth &&
        newShelfY + layer.height + padding <= sheetHeight
      ) {
        const newShelf = { y: newShelfY, height: layer.height, currentX: padding };
        shelves.push(newShelf);
        bestFit = {
          x: padding,
          y: newShelfY,
          rotation: 0,
          shelfIndex: shelves.length - 1
        };
      }
      // Try with rotation on new shelf
      else if (
        padding + layer.height + padding <= sheetWidth &&
        newShelfY + layer.width + padding <= sheetHeight
      ) {
        const newShelf = { y: newShelfY, height: layer.width, currentX: padding };
        shelves.push(newShelf);
        bestFit = {
          x: padding,
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
      // Item too large - place at origin with warning
      console.warn(`Layer ${layer.id} is too large to fit on sheet`);
      positions.push({
        id: layer.id,
        x: padding,
        y: padding,
        rotation: layer.rotation || 0
      });
    }
  }

  // Calculate efficiency
  const totalLayerArea = layers.reduce((sum, l) => sum + (l.width * l.height), 0);
  const sheetArea = sheetWidth * sheetHeight;
  const efficiency = Math.round((totalLayerArea / sheetArea) * 100);
  const wastedSpace = sheetArea - totalLayerArea;

  return {
    positions,
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

  // Use the first/smallest layer as the template to duplicate
  const template = layers.reduce((smallest, current) => {
    const smallestArea = smallest.width * smallest.height;
    const currentArea = current.width * current.height;
    return currentArea < smallestArea ? current : smallest;
  }, layers[0]);

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

      // Check if this position would overlap with existing layers
      const overlaps = layers.some(existing => {
        const existingRight = existing.width;
        const existingBottom = existing.height;
        const newRight = x + template.width;
        const newBottom = y + template.height;

        // Simple AABB collision detection (assumes no rotation for simplicity)
        return !(
          x >= existingRight ||
          newRight <= 0 ||
          y >= existingBottom ||
          newBottom <= 0
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

  // Calculate coverage
  const filledArea = (layers.length + duplicates.length) * (template.width * template.height);
  const sheetArea = sheetWidth * sheetHeight;
  const coverage = Math.round((filledArea / sheetArea) * 100);

  return {
    duplicates,
    coverage,
    totalAdded: duplicates.length
  };
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
