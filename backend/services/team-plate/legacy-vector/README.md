# legacy-vector — QUARANTINED (2026-09-23, task 65d98dd9)

The opentype.js vector lettering engine (fit / fonts / svg / render) that used
to draw the customer's name and number onto an erased plate.

It is **out of the production order path**. Nothing under `routes/` or
`plate-store.ts` renders with it any more: per-order lettering is now a
`gpt-image-2.5-flare` edit of the tagged back artwork, chained into
`recraft-crisp-upscale` (see `../generate.ts` and `../plate-store.ts`).

David 2026-09-22: "the easiest and best way to do it is to just have gpt2.5
flare just redo the design keeping things intact and just redoin the name and
number. it will cost more but will come out the cleanest we will make the $$
back with the sale."

Kept, with its tests, only so the maths is recoverable if the AI path ever has
to be rolled back. The one remaining import is `HOUSE_FONTS` (ids + labels),
which the admin authoring screen still lists as a style hint. Delete this
folder once the flare path has pressed real orders cleanly.
