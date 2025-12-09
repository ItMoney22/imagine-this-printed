# Documentation Index

**Last Updated:** 2025-12-09

This index lists all active documentation. For historical/completed docs, see `docs/archive/`.

---

## Quick Links

| Document | Status | Description |
|----------|--------|-------------|
| [CLAUDE_SESSION.md](../CLAUDE_SESSION.md) | ACTIVE | Current session state and tasks |
| [CLAUDE.md](../CLAUDE.md) | ACTIVE | Project overview for Claude Code |

---

## Active Documentation

### Core Project Docs
| Document | Status | Description |
|----------|--------|-------------|
| [AI_PRODUCT_BUILDER.md](AI_PRODUCT_BUILDER.md) | CURRENT | AI product builder overview |
| [AI_PRODUCT_BUILDER_PIPELINE.md](AI_PRODUCT_BUILDER_PIPELINE.md) | CURRENT | Complete pipeline reference (production ready) |
| [CUSTOMER_AI_PRODUCT_BUILDER.md](CUSTOMER_AI_PRODUCT_BUILDER.md) | CURRENT | Customer-facing AI builder docs |
| [ENV_VARIABLES.md](ENV_VARIABLES.md) | CURRENT | Environment variable reference |
| [README.md](README.md) | CURRENT | General documentation overview |

### Feature Status Docs
| Document | Status | Description |
|----------|--------|-------------|
| [VOICE_PRODUCT_CREATION_STATUS.md](../VOICE_PRODUCT_CREATION_STATUS.md) | IN_PROGRESS | Voice-guided product creation (backend done, frontend pending) |
| [GEMINI_VOICE_UI_IMPLEMENTATION.md](../GEMINI_VOICE_UI_IMPLEMENTATION.md) | REFERENCE | Frontend implementation guide for voice UI |
| [AI_CONCIERGE_ENHANCEMENTS.md](../AI_CONCIERGE_ENHANCEMENTS.md) | IN_PROGRESS | Mr. Imagine AI concierge features |

### Checklists & Improvements
| Document | Status | Description |
|----------|--------|-------------|
| [PRODUCTION_READINESS_CHECKLIST.md](PRODUCTION_READINESS_CHECKLIST.md) | IN_PROGRESS | Production optimization checklist |
| [PRODUCT_SYSTEM_IMPROVEMENTS_NEEDED.md](PRODUCT_SYSTEM_IMPROVEMENTS_NEEDED.md) | IN_PROGRESS | Known issues and fixes needed |
| [MOCKUP_GENERATOR_PERFORMANCE.md](MOCKUP_GENERATOR_PERFORMANCE.md) | CURRENT | Mockup generation performance notes |

### Setup & Deployment
| Document | Status | Description |
|----------|--------|-------------|
| [SUPABASE_SETUP_COMPLETE.md](SUPABASE_SETUP_COMPLETE.md) | COMPLETED | Supabase infrastructure setup (done) |
| [TASK-5-TRIGGERS-SETUP.md](TASK-5-TRIGGERS-SETUP.md) | COMPLETED | Database triggers setup (done) |
| [WALLET_SYSTEM_COMPLETE.md](WALLET_SYSTEM_COMPLETE.md) | COMPLETED | Wallet system implementation (done) |
| [DESIGN_STUDIO_QUICKSTART.md](DESIGN_STUDIO_QUICKSTART.md) | CURRENT | Design studio quick start guide |
| [deployment-checklist.md](deployment-checklist.md) | CURRENT | Deployment checklist |

### Admin Features
| Document | Status | Description |
|----------|--------|-------------|
| Support Ticket System | COMPLETED | Admin support tickets - `backend/routes/admin/support.ts`, `src/components/AdminSupport.tsx` |

### Plans (Active)
| Document | Status | Description |
|----------|--------|-------------|
| [plans/2025-12-09-frontend-design-center-integration.md](plans/2025-12-09-frontend-design-center-integration.md) | PLANNED | Frontend design center integration |
| [plans/2025-12-09-ai-product-builder-asset-refactor.md](plans/2025-12-09-ai-product-builder-asset-refactor.md) | COMPLETED | AI asset management refactor |
| [plans/2025-11-12-realistic-mockup-generator.md](plans/2025-11-12-realistic-mockup-generator.md) | IN_PROGRESS | Realistic mockup generator |

---

## Archive

Historical documentation for completed features, old task reports, and deprecated docs are in `docs/archive/`. These are kept for reference but are no longer actively maintained.

See: [archive/README.md](archive/README.md)

---

## Status Legend

| Status | Meaning |
|--------|---------|
| CURRENT | Up-to-date reference documentation |
| IN_PROGRESS | Feature being actively worked on |
| PLANNED | Approved plan, not yet started |
| COMPLETED | Feature done, doc kept for reference |
| REFERENCE | Implementation guide / spec |
| DEPRECATED | No longer relevant, consider archiving |

---

## Pending Migrations

These SQL migrations exist but have not been applied to the database:

1. `backend/migrations/create_admin_settings.sql` - Voice settings table
2. `backend/migrations/create_user_royalty_system.sql` - User royalty tracking

To apply: Copy SQL to Supabase Dashboard > SQL Editor > Run

## Recently Applied Migrations

1. `backend/db/migrations/01_support_system.sql` - Support tickets and messages tables (applied 2025-12-09)
