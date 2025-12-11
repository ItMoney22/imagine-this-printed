// backend/config/imagination-presets.ts

export interface PrintTypeRules {
  mirror: boolean;
  whiteInk: boolean;
  cutlineOption?: boolean;
  minDPI: number;
}

export interface PrintTypePreset {
  width: number;
  heights: number[];
  rules: PrintTypeRules;
  displayName: string;
  description: string;
}

export type PrintType = 'dtf' | 'uv_dtf' | 'sublimation';

export const SHEET_PRESETS: Record<PrintType, PrintTypePreset> = {
  dtf: {
    width: 22.5,
    heights: [24, 36, 48, 53, 60, 72, 84, 96, 108, 120, 132, 144, 168, 192, 216, 240],
    rules: {
      mirror: false,
      whiteInk: true,
      minDPI: 300
    },
    displayName: 'DTF (Direct-to-Film)',
    description: '22.5" width, any color, no mirroring required'
  },
  uv_dtf: {
    width: 16,
    heights: [12, 24, 36, 48, 60, 72, 84, 96, 108, 120],
    rules: {
      mirror: false,
      whiteInk: true,
      cutlineOption: true,
      minDPI: 300
    },
    displayName: 'UV DTF (Stickers)',
    description: '16" width, hard surface transfers, optional cutlines'
  },
  sublimation: {
    width: 22,
    heights: [24, 36, 48, 60, 72, 84, 96, 120],
    rules: {
      mirror: true,
      whiteInk: false,
      minDPI: 300
    },
    displayName: 'Sublimation',
    description: '22" width, no white ink, mirroring often required'
  }
};

export const DEFAULT_PRINT_TYPE: PrintType = 'dtf';
export const DEFAULT_SHEET_HEIGHT = 48;

export const CANVAS_SETTINGS = {
  marginInches: 0.25,
  gapInches: 0.25,
  gridSizeInches: 0.25,
  maxZoom: 4,
  minZoom: 0.25,
  defaultZoom: 1,
  historyLimit: 50,
  autoSaveLocalMs: 10000,  // 10 seconds
  autoSaveCloudMs: 60000,  // 60 seconds
};

export const AI_STYLES = [
  { key: 'realistic', label: 'Realistic', prompt_suffix: 'photorealistic, high detail, professional photography' },
  { key: 'cartoon', label: 'Cartoon', prompt_suffix: 'cartoon style, vibrant colors, bold outlines' },
  { key: 'vintage', label: 'Vintage', prompt_suffix: 'vintage style, retro, aged paper texture, nostalgic' },
  { key: 'minimalist', label: 'Minimalist', prompt_suffix: 'minimalist design, clean lines, simple shapes' },
  { key: 'vaporwave', label: 'Vaporwave', prompt_suffix: 'vaporwave aesthetic, neon colors, 80s retro futurism' },
];

export function getSheetPrice(printType: PrintType, height: number): number {
  // Base pricing logic - can be expanded
  const sqInches = SHEET_PRESETS[printType].width * height;
  const pricePerSqInch = 0.02; // $0.02 per square inch base
  return Math.round(sqInches * pricePerSqInch * 100) / 100;
}

export function validateSheetSize(printType: PrintType, height: number): boolean {
  return SHEET_PRESETS[printType].heights.includes(height);
}
