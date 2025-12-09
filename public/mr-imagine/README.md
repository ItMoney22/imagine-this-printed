# Mr. Imagine - Mascot Assets Guide

Welcome to the Mr. Imagine mascot system! This folder contains all the assets for Mr. Imagine, the friendly mascot of ImagineThisPrinted.

## Required Assets

Please add the following images to make Mr. Imagine fully functional across the site.

### 1. Main Character Assets (Root folder)

| Filename | Purpose | Recommended Size | Notes |
|----------|---------|------------------|-------|
| `mr-imagine-standing.png` | Full body, default pose | 800x1200px | Transparent background, character facing forward |
| `mr-imagine-standing-happy.png` | Full body, happy/smiling | 800x1200px | Excited pose for success states |
| `mr-imagine-waving.png` | Full body, waving hello | 800x1200px | Greeting pose for hero section |
| `mr-imagine-pointing.png` | Full body, pointing gesture | 800x1200px | For directing user attention |
| `mr-imagine-waist-up.png` | Waist up, default | 500x600px | For chat widget messages |
| `mr-imagine-waist-up-happy.png` | Waist up, happy | 500x600px | After successful chat responses |
| `mr-imagine-waist-up-thinking.png` | Waist up, thinking pose | 500x600px | While loading/processing |
| `mr-imagine-waist-up-confused.png` | Waist up, confused | 500x600px | When needing clarification |
| `mr-imagine-head.png` | Head only, default | 200x200px | Small avatar in chat bubbles |
| `mr-imagine-head-happy.png` | Head only, happy | 200x200px | Happy small avatar |
| `mr-imagine-head-thinking.png` | Head only, thinking | 200x200px | Thinking small avatar |
| `mr-imagine-chat-button.png` | Circular icon | 128x128px | For the floating chat button |
| `mr-imagine-hero.png` | Large hero image | 1000x1200px | Main hero section display |

### 2. Mockup Assets (mockups/ folder)

These are images of Mr. Imagine WEARING the products. The design will be overlaid on the shirt area.

#### T-Shirt Mockups
| Filename | Purpose | Recommended Size |
|----------|---------|------------------|
| `mr-imagine-tshirt-white-front.png` | White t-shirt, front view | 500x600px |
| `mr-imagine-tshirt-white-back.png` | White t-shirt, back view | 500x600px |
| `mr-imagine-tshirt-black-front.png` | Black t-shirt, front view | 500x600px |
| `mr-imagine-tshirt-black-back.png` | Black t-shirt, back view | 500x600px |
| `mr-imagine-tshirt-gray-front.png` | Gray t-shirt, front view | 500x600px |
| `mr-imagine-tshirt-gray-back.png` | Gray t-shirt, back view | 500x600px |

#### Hoodie Mockups
| Filename | Purpose | Recommended Size |
|----------|---------|------------------|
| `mr-imagine-hoodie-white-front.png` | White hoodie, front view | 500x600px |
| `mr-imagine-hoodie-black-front.png` | Black hoodie, front view | 500x600px |

#### Tank Top Mockups
| Filename | Purpose | Recommended Size |
|----------|---------|------------------|
| `mr-imagine-tank-white-front.png` | White tank top, front | 500x600px |
| `mr-imagine-tank-black-front.png` | Black tank top, front | 500x600px |

## Design Zone Coordinates

When creating mockup images, the design will be placed in these areas (based on 500x600 image):

### T-Shirt (Front/Back)
- **Position**: x=150, y=180
- **Size**: 200x250 pixels
- Center the printable area of the shirt at this location

### Hoodie (Front)
- **Position**: x=140, y=200
- **Size**: 220x280 pixels

### Tank Top (Front)
- **Position**: x=155, y=170
- **Size**: 190x240 pixels

## Character Style Guidelines

For consistency, Mr. Imagine should:

1. **Color Palette**: Match the ImagineThisPrinted brand
   - Primary Purple: `#a855f7` / `#9333ea`
   - Secondary Blue: `#3b82f6`
   - Accent Pink: `#ec4899`

2. **Style**: Friendly, approachable character
   - Can be cartoon/illustrated or 3D rendered
   - Should look professional but fun
   - Tech-savvy appearance (maybe wearing headphones or tech accessories)

3. **Transparent Background**: All PNG files should have transparent backgrounds

4. **Consistent Lighting**: Same lighting direction across all poses

5. **File Format**: PNG with alpha channel (transparency)

## Quick Start

To get Mr. Imagine working immediately, you only need these 3 files:
1. `mr-imagine-standing.png` - For hero section fallback
2. `mr-imagine-head.png` - For chat widget
3. `mr-imagine-tshirt-white-front.png` - For mockups

The system will show placeholder graphics until you add the actual images.

## Component Usage

After adding assets, Mr. Imagine components are available throughout the app:

```tsx
// Import from the mr-imagine component folder
import {
  MrImagineAvatar,
  MrImagineChatWidget,
  MrImagineHero,
  MrImagineMockup
} from '@/components/mr-imagine'

// Avatar component
<MrImagineAvatar
  size="lg"
  expression="happy"
  pose="standing"
/>

// Mockup with design overlay
<MrImagineMockup
  designUrl="/path/to/design.png"
  product="tshirt"
  color="white"
  size="lg"
/>
```

## File Structure

```
public/mr-imagine/
├── README.md (this file)
├── mr-imagine-standing.png
├── mr-imagine-standing-happy.png
├── mr-imagine-waving.png
├── mr-imagine-pointing.png
├── mr-imagine-waist-up.png
├── mr-imagine-waist-up-happy.png
├── mr-imagine-waist-up-thinking.png
├── mr-imagine-waist-up-confused.png
├── mr-imagine-head.png
├── mr-imagine-head-happy.png
├── mr-imagine-head-thinking.png
├── mr-imagine-chat-button.png
├── mr-imagine-hero.png
└── mockups/
    ├── mr-imagine-tshirt-white-front.png
    ├── mr-imagine-tshirt-white-back.png
    ├── mr-imagine-tshirt-black-front.png
    ├── mr-imagine-tshirt-black-back.png
    ├── mr-imagine-tshirt-gray-front.png
    ├── mr-imagine-tshirt-gray-back.png
    ├── mr-imagine-hoodie-white-front.png
    ├── mr-imagine-hoodie-black-front.png
    ├── mr-imagine-tank-white-front.png
    └── mr-imagine-tank-black-front.png
```

## Integration Points

Mr. Imagine appears in these locations:

1. **Hero Section** (Home page) - Large standing pose with speech bubble
2. **Chat Widget** (Global) - Floating button + chat panel with avatar
3. **AI Product Builder** - Mr. Imagine wearing the generated design
4. **Empty States** - Friendly presence on empty pages
5. **Loading States** - Thinking pose while processing

## Need Help?

The component system is designed to gracefully handle missing assets with placeholders. Start by adding the essential files and expand from there!
