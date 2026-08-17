# Production Deployment Checklist

## 🔒 Security & Environment

### Backend Environment Variables
- [ ] Change `NODE_ENV` from "development" to "production" in `backend/.env`
- [ ] Verify all API keys are production keys (not test/sandbox):
  - [ ] Stripe keys (STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY)
  - [ ] Stripe webhook secret (STRIPE_WEBHOOK_SECRET)
  - [ ] OpenAI API key
  - [ ] Replicate API token
  - [ ] Remove.bg API key
  - [ ] Brevo API key
  - [ ] SerpAPI key
- [ ] Verify Google Cloud Storage credentials are for production project
- [ ] Generate new JWT_SECRET for production (currently using development secret)
- [ ] Set secure CORS origins (remove wildcard/localhost):
  ```
  ALLOWED_ORIGINS=https://imaginethisprinted.com,https://api.imaginethisprinted.com
  ```
- [ ] Update `FRONTEND_URL` and `APP_ORIGIN` to production domains
- [ ] Set `PUBLIC_URL` to production API domain

### Frontend Environment Variables
- [ ] Update `.env.production` or Railway env vars:
  - [ ] `VITE_API_BASE=https://api.imaginethisprinted.com`
  - [ ] `VITE_SITE_URL=https://imaginethisprinted.com`
  - [ ] `VITE_STRIPE_PUBLISHABLE_KEY` (production key)
  - [ ] Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

### Supabase Configuration
- [ ] Verify Site URL: `https://imaginethisprinted.com`
- [ ] Update Redirect URLs to production only:
  ```
  https://imaginethisprinted.com/auth/callback
  https://imaginethisprinted.com/auth/reset-password
  ```
- [ ] Remove localhost URLs from allowed redirects
- [ ] Verify Google OAuth redirect URI matches production
- [ ] Review and test all RLS (Row Level Security) policies
- [ ] Verify database triggers are active (user_profiles, user_wallets)
- [ ] Check database indexes for performance
- [ ] Set up database backups (if not auto-configured)

### API Keys & Webhooks
- [ ] Update Stripe webhook endpoint to production URL:
  ```
  https://api.imaginethisprinted.com/api/stripe/webhook
  ```
- [ ] Test Stripe webhook with production endpoint
- [ ] Verify Replicate webhook callback URL (if used)
- [ ] Update any other webhook endpoints to production

## 🧪 Testing

### Functionality Testing
- [ ] Test complete user registration flow
- [ ] Test email login and password reset
- [ ] Test Google OAuth login
- [ ] Test wallet functionality:
  - [ ] ITC balance display
  - [ ] Points balance display
  - [ ] Transaction history (ITC and Points)
  - [ ] Stripe ITC purchase flow
- [ ] Test Design Studio modal from all entry points:
  - [ ] Navbar button
  - [ ] Header button
  - [ ] Product pages
  - [ ] Home page
- [ ] Test product catalog and filtering
- [ ] Test shopping cart:
  - [ ] Add to cart
  - [ ] Update quantities
  - [ ] Remove items
  - [ ] Cart persistence
- [ ] Test checkout flow with Stripe
- [ ] Test order confirmation and emails
- [ ] Test admin dashboard (if admin role exists)
- [ ] Test all role-based access controls
- [ ] Test 3D model gallery
- [ ] Test messaging system
- [ ] Test referral system

### Mobile Testing
- [ ] Test responsive design on mobile devices
- [ ] Test touch interactions on Design Studio
- [ ] Test navigation on mobile
- [ ] Test checkout flow on mobile

### Performance Testing
- [ ] Run Lighthouse audit
- [ ] Check page load times
- [ ] Verify image optimization
- [ ] Test with slow network conditions
- [ ] Check bundle size: `npm run build` and review dist/

### Browser Testing
- [ ] Chrome/Edge (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Mobile Safari (iOS)
- [ ] Mobile Chrome (Android)

## 🚀 Build & Deployment

### Frontend Build
- [ ] Run production build: `npm run build`
- [ ] Verify no build errors or warnings
- [ ] Check bundle size (should be < 500KB gzipped)
- [ ] Test production build locally: `npm run preview`
- [ ] Verify all routes work in production build
- [ ] Check that environment variables are correctly embedded

### Backend Build
- [ ] Run TypeScript compilation: `cd backend && npx tsc`
- [ ] Fix any TypeScript errors
- [ ] Test backend with production environment variables locally
- [ ] Verify all API endpoints respond correctly
- [ ] Test database connections with production credentials

### Railway Deployment
- [ ] Update Railway environment variables for backend service
- [ ] Update Railway environment variables for frontend service
- [ ] Deploy backend first, verify health endpoints:
  - `https://api.imaginethisprinted.com/api/health`
  - `https://api.imaginethisprinted.com/api/health/email`
  - `https://api.imaginethisprinted.com/api/health/database`
- [ ] Deploy frontend after backend is stable
- [ ] Verify deployment logs for errors
- [ ] Test production site end-to-end

### DNS & SSL
- [ ] Verify DNS records point to Railway/VPS:
  - [ ] `imaginethisprinted.com` → frontend service
  - [ ] `api.imaginethisprinted.com` → backend service
- [ ] Verify SSL certificates are active (HTTPS)
- [ ] Test SSL configuration: https://www.ssllabs.com/ssltest/
- [ ] Set up www redirect if needed

## 📊 Monitoring & Logging

### Error Tracking
- [ ] Set up Sentry or similar error tracking (optional)
- [ ] Configure error alerts
- [ ] Test error reporting

### Logging
- [ ] Verify backend logging is production-appropriate (not debug level)
- [ ] Set `LOG_LEVEL=info` in production
- [ ] Remove any console.log debugging statements
- [ ] Configure log rotation (if using VPS)

### Analytics
- [ ] Set up Google Analytics (if planned)
- [ ] Configure conversion tracking
- [ ] Test analytics tracking

### Uptime Monitoring
- [ ] Set up uptime monitoring (e.g., UptimeRobot, Pingdom)
- [ ] Configure alerts for downtime
- [ ] Monitor health endpoints

## 🗄️ Database

### Data Management
- [ ] Verify database has proper indexes
- [ ] Run vacuum/analyze on PostgreSQL (if applicable)
- [ ] Set up automated backups
- [ ] Test database restore procedure
- [ ] Review and optimize slow queries

### Data Migration
- [ ] If migrating from development to production database:
  - [ ] Export essential data (products, mockups)
  - [ ] Clean test data (test users, orders)
  - [ ] Import into production
  - [ ] Verify data integrity

## 🔐 Security Hardening

### API Security
- [ ] Rate limiting enabled
- [ ] CORS properly configured (no wildcards)
- [ ] Input validation on all endpoints
- [ ] SQL injection protection (using parameterized queries)
- [ ] XSS protection (sanitizing outputs)
- [ ] CSRF protection (if needed)
- [ ] Authentication required on protected routes

### Content Security
- [ ] Review Content Security Policy headers
- [ ] Verify file upload size limits
- [ ] Validate file types for uploads
- [ ] Sanitize user-generated content

### Infrastructure
- [ ] Change default ports (if using VPS)
- [ ] Disable unnecessary services
- [ ] Keep dependencies updated: `npm audit fix`
- [ ] Review npm audit report
- [ ] Update Node.js to LTS version

## 📝 Documentation

### Code Documentation
- [ ] Update README.md with production setup
- [ ] Document environment variables
- [ ] Document deployment process
- [ ] Update API documentation (if exists)

### User Documentation
- [ ] Create user guides (if needed)
- [ ] Set up help/FAQ section
- [ ] Document Design Studio features

### Legal
- [ ] Privacy Policy page
- [ ] Terms of Service page
- [ ] Cookie consent (if tracking users)
- [ ] GDPR compliance (if applicable)
- [ ] Payment processing disclosures

## 🎨 UI/UX Polish

### Content
- [ ] Replace placeholder images
- [ ] Proofread all text content
- [ ] Verify email templates
- [ ] Test all email deliverability
- [ ] Add proper meta tags (SEO)
- [ ] Set up Open Graph tags for social sharing
- [ ] Add favicon.ico

### Design
- [ ] Verify theme consistency (light/dark modes)
- [ ] Check for broken images
- [ ] Test all animations
- [ ] Verify loading states
- [ ] Check error messages are user-friendly

## 🚦 Pre-Launch

### Final Checks
- [ ] Test complete user journey (signup → design → purchase → checkout)
- [ ] Verify payment processing with real payment method
- [ ] Test refund process (if applicable)
- [ ] Check email notifications for all events
- [ ] Test password reset flow
- [ ] Verify social OAuth flows
- [ ] Test on real mobile devices
- [ ] Cross-browser final check

### Soft Launch
- [ ] Deploy to production
- [ ] Test with small group of beta users
- [ ] Monitor error logs closely
- [ ] Fix any critical issues
- [ ] Verify performance under real load

### Launch Day
- [ ] Final deployment
- [ ] Monitor server metrics
- [ ] Watch error logs
- [ ] Test critical paths
- [ ] Have rollback plan ready
- [ ] Announce launch

## 📈 Post-Launch

### Week 1
- [ ] Monitor uptime (target 99.9%+)
- [ ] Review error logs daily
- [ ] Check performance metrics
- [ ] Gather user feedback
- [ ] Fix critical bugs immediately

### Ongoing
- [ ] Set up regular security updates
- [ ] Plan feature releases
- [ ] Monitor costs (Supabase, Railway, API usage)
- [ ] Review analytics weekly
- [ ] Respond to user support requests

## 🔧 Quick Fixes Needed

### High Priority
1. **JWT Secret**: Generate production JWT secret
2. **Stripe Webhook**: Update to production endpoint and secret
3. **CORS**: Lock down to production domains only
4. **NODE_ENV**: Change to production in backend
5. **Remove Development URLs**: Clean up Supabase redirect URLs

### Medium Priority
1. **Bundle Size**: Review and optimize if > 500KB
2. **Error Tracking**: Set up Sentry or similar
3. **Rate Limiting**: Implement API rate limits
4. **Email Testing**: Send test emails from production
5. **Legal Pages**: Add Terms, Privacy Policy

### Low Priority
1. **SEO Optimization**: Meta tags, sitemap.xml, robots.txt
2. **Analytics**: Google Analytics or similar
3. **Documentation**: User guides and help section
4. **Performance**: Lighthouse audit and optimization
5. **Monitoring**: Uptime and performance monitoring

---

## Notes

- **Backend logs show development mode**: Currently `NODE_ENV=development` in backend/.env
- **CORS is wide open**: Currently allows all origins in development
- **Unlimited ITC granted**: User has 999,999 ITC tokens for testing
- **Design Studio working**: Modal now uses React Portal, works from all entry points
- **Wallet functional**: Backend API responding correctly with CORS working

**Estimated time to production-ready**: 2-4 hours for high priority items, 1-2 days for full checklist.
