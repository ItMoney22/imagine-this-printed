# studio-kit (vendored)

The guided step flow — Type, Brief, Generate, Pick, Shots, Submit — with the
mascot panel and the progress bars. Used here by
`src/components/studio/CustomerStudio.tsx`, which is the only file that knows
anything about ImagineThisPrinted.

**Nothing in this folder may import from outside it.** That constraint is the
whole point: it is what lets the same flow be dropped into a client site.

## This is a vendored copy

Canonical source, and the full documentation:

    E:\Projects for MetaSphere\metasphere-studio-kit

It lives there so new client sites start from a neutral home rather than from
this repo. It is *also* here because a Vercel build only ever sees this
repository — an import pointing at E: would break the deploy.

Changing the flow itself: edit it in the canonical kit, then copy `src/*` back
over this folder. Changing how ITP uses it: edit `CustomerStudio.tsx` instead.
