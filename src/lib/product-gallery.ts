/**
 * Product gallery contract — re-export shim.
 *
 * The canonical implementation moved to `backend/shared/product-gallery.ts`
 * (2026-09-01 review fix) so the backend's Step Flow publish route and every
 * frontend publish path share exactly one ROLE_ORDER instead of two copies
 * that had already drifted (mr_imagine sat in a different position in each).
 * `backend/shared/` is already the frontend/backend shared-code convention —
 * see `src/lib/product-kind.ts` importing `backend/shared/metal-art`, or
 * `src/components/studio/GarmentStep.tsx` importing
 * `backend/shared/catalog-capability`.
 *
 * Keep every named export the frontend uses re-exported here so nothing that
 * imports from `@/lib/product-gallery` (or `../lib/product-gallery`) has to
 * change.
 */
export type { GalleryAsset } from '../../backend/shared/product-gallery'
export { ROLE_ORDER, POCKET_ROLE, BACK_ROLE, buildProductGallery } from '../../backend/shared/product-gallery'
