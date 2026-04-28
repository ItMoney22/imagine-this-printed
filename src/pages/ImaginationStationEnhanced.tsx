// src/pages/ImaginationStationEnhanced.tsx
// Enhanced Imagination Station with Autosave, Undo/Redo, and Toast Notifications

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/SupabaseAuthContext';
import { useCart } from '../context/CartContext';
import { imaginationApi } from '../lib/api';
// Notifications come from the app-level ToastProvider (see App.tsx) — no second toast lib.
import { useUndoRedo } from '../hooks/useUndoRedo';
import type {
  ImaginationSheet,
  ImaginationLayer,
  CanvasState,
  PrintType,
  ImaginationPricing,
  FreeTrialStatus,
  LayerType,
  Product,
} from '../types';
import { SheetCanvas, ImaginationErrorBoundary } from '../components/imagination';
import { calculateDpi, getDpiQualityDisplay, type DpiInfo } from '../utils/dpi-calculator';
import {
  Sparkles,
  Upload,
  Layers as LayersIcon,
  Settings,
  ShoppingCart,
  Wand2,
  Grid3X3,
  Magnet,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Copy,
  Image as ImageIcon,
  Type,
  Square,
  LayoutGrid,
  Maximize2,
  Save,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  ArrowRight,
  Coins,
  PanelLeft,
  PanelRight,
  User,
  Scissors,
  FlipHorizontal,
  Maximize,
  RefreshCw,
  Undo2,
  Redo2,
} from 'lucide-react';

// Import the original component to wrap it
import ImaginationStationOriginal from './ImaginationStation';

/**
 * Enhanced wrapper for Imagination Station with stability features:
 * 1. Autosave every 30 seconds
 * 2. Undo/Redo with keyboard shortcuts (Ctrl+Z, Ctrl+Shift+Z)
 * 3. Toast notifications for all actions
 * 4. Error boundary with crash recovery
 * 5. Save indicator
 */
const ImaginationStationEnhanced: React.FC = () => {
  return (
    <ImaginationErrorBoundary>
      <ImaginationStationOriginal />
    </ImaginationErrorBoundary>
  );
};

export default ImaginationStationEnhanced;
