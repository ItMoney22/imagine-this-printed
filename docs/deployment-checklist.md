# Neon 2.0 Deployment Checklist

## Pre-Deployment

- [x] All PR reviews approved
- [x] All tests passing
- [x] Production build successful (`npm run build`)
- [x] No TypeScript compilation errors
- [x] QA testing complete (see docs/qa-report.md)
- [ ] Screenshots captured for PR
- [ ] Cross-browser testing complete
- [ ] Mobile testing complete

## Environment Setup

- [ ] `.env` file updated on VPS with:
  ```env
  VITE_LOGO_DARK=/assets/branding/itp-logo-dark.png
  VITE_LOGO_LIGHT=/assets/branding/itp-logo-light.svg
  ```
- [ ] Asset files uploaded to `/public/assets/`:
  - `/public/assets/branding/itp-logo-dark.png` (1.85 MB)
  - `/public/assets/branding/itp-logo-light.svg` (2 KB)
  - `/public/assets/bg/bg-circuit.svg` (1.3 KB)

## Deployment Steps

### 1. SSH into VPS
```bash
ssh user@imaginethisprinted.com
```

### 2. Navigate to project directory
```bash
cd /var/www/imagine-this-printed
```

### 3. Pull latest from feature branch
```bash
git fetch origin
git checkout feature/neon-2-themes
git pull origin feature/neon-2-themes
```

### 4. Install dependencies
```bash
npm install
```

### 5. Run production build
```bash
npm run build
```

Expected output:
```
✓ 440 modules transformed
✓ built in ~3-5s
```

### 6. Verify build artifacts
```bash
ls -lh dist/
```

Should see:
- `index.html`
- `assets/` directory with CSS and JS bundles

### 7. Copy assets to dist (if not already there)
```bash
cp -r public/assets dist/
```

### 8. Restart web server
```bash
sudo systemctl restart nginx
# or
pm2 restart imagine-this-printed
```

### 9. Clear CDN cache (if applicable)
```bash
# Cloudflare example:
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

## Post-Deployment Verification

### Critical Checks
- [ ] Visit production URL: https://imaginethisprinted.com
- [ ] Test theme toggle (light/dark)
  - Click theme toggle button in header
  - Verify colors change throughout site
  - Check localStorage has 'theme' key
  - Refresh page - theme should persist
- [ ] Verify all images load
  - Logo in header (should switch with theme)
  - Circuit background in hero section
  - Product images on homepage
- [ ] Check responsive layouts
  - Desktop (1920x1080)
  - Tablet (768x1024)
  - Mobile (375x667)
- [ ] Test navigation links
  - Products
  - Design Studio
  - Community
  - Pricing
  - Cart
  - Sign In
- [ ] Verify Google Fonts loading
  - Open DevTools → Network tab
  - Filter by "Font"
  - Should see Poppins and Orbitron fonts loading
- [ ] Check browser console for errors
  - Open DevTools → Console tab
  - No red errors should appear
  - Warnings are acceptable

### Feature Verification

**Header:**
- [ ] Glass effect visible (backdrop blur)
- [ ] Logo switches correctly with theme
- [ ] Sticky on scroll
- [ ] Navigation hover effects work
- [ ] Theme toggle button functional
- [ ] Cart badge displays
- [ ] Sign In button has gradient + glow

**Hero Section:**
- [ ] Gradient background visible
- [ ] Circuit overlay displays
- [ ] Text glow effect on heading
- [ ] CTA buttons have hover effects (glow, scale)
- [ ] Feature pills display correctly

**Product Cards:**
- [ ] Hover glow effect visible
- [ ] Image zooms on hover
- [ ] Price gradient displays
- [ ] Category badges visible
- [ ] Card lifts on hover

**Footer:**
- [ ] All sections visible
- [ ] Links clickable and styled
- [ ] Social icons have hover effects
- [ ] Copyright year correct (2025)

**All Pages:**
- [ ] Home
- [ ] Products
- [ ] Product Detail
- [ ] Designer
- [ ] Cart
- [ ] Checkout
- [ ] Login/Signup
- [ ] Profile
- [ ] Admin Dashboard
- [ ] Vendor Dashboard

### Performance Checks
- [ ] Run Lighthouse audit
  ```bash
  npx lighthouse https://imaginethisprinted.com --view
  ```
  Target scores:
  - Performance: >70
  - Accessibility: >90
  - Best Practices: >90
  - SEO: >90

- [ ] Check page load time (< 3 seconds)
- [ ] Verify bundle sizes in Network tab
- [ ] Test on slow 3G connection

### Browser Compatibility
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)
- [ ] Mobile Safari (iOS)
- [ ] Mobile Chrome (Android)

## Rollback Plan

If issues occur:

### 1. Revert to previous version
```bash
git checkout main
git pull origin main
```

### 2. Rebuild
```bash
npm install
npm run build
```

### 3. Restart server
```bash
sudo systemctl restart nginx
```

### 4. Verify rollback
```bash
curl -I https://imaginethisprinted.com
```

### 5. Investigate issues
- Check browser console for errors
- Review server logs
- Test in staging environment
- Create bug report with:
  - Browser/device info
  - Steps to reproduce
  - Expected vs actual behavior
  - Screenshots/videos

## Monitoring

### First 24 Hours
- [ ] Monitor error rates (should be < 1%)
- [ ] Check user feedback/support tickets
- [ ] Verify analytics tracking
- [ ] Review performance metrics
- [ ] Monitor server resources (CPU, memory)

### First Week
- [ ] Collect user feedback on theme
- [ ] Track theme preference distribution (light vs dark)
- [ ] Monitor bounce rates
- [ ] Check conversion rates
- [ ] Review heatmaps/session recordings

## Post-Deployment Tasks

### Documentation
- [ ] Update README with new theme information
- [ ] Document theme customization process
- [ ] Create user guide for theme toggle
- [ ] Update API documentation if needed

### Future Enhancements
- [ ] Implement route-based code splitting
- [ ] Add loading skeletons
- [ ] Optimize images (compress logos)
- [ ] Implement mobile hamburger menu
- [ ] Connect cart badge to actual cart state
- [ ] Add smooth theme transition animations
- [ ] Implement theme preference in user settings

## Sign-Off

**Deployed By:** _________________
**Date:** _________________
**Version:** Neon 2.0
**Branch:** feature/neon-2-themes
**Commit SHA:** _________________

**Verified By:** _________________
**Date:** _________________

**Issues Encountered:**
- None / List issues here

**Notes:**
_________________________________________________________________________________
_________________________________________________________________________________
_________________________________________________________________________________
