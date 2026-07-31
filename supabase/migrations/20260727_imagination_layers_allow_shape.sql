-- Imagination Sheet layers: allow the 'shape' layer type.
--
-- The designer has always been able to create shape layers (rectangles,
-- circles, arrows), but 20251211_imagination_station.sql:25 constrained
-- layer_type to ('image', 'ai_generated', 'text'). Any attempt to persist a
-- shape was rejected by the CHECK constraint.
--
-- Until 2026-07-27 this was invisible: the save route destructured `layers`
-- and never wrote them at all, so nothing ever hit the constraint. Now that
-- layer persistence is real (task cc629cad), the constraint is the thing
-- standing between a customer's shape layer and it surviving a reload.
--
-- Idempotent: safe to re-run, and a no-op if the constraint is already correct.

ALTER TABLE imagination_layers
  DROP CONSTRAINT IF EXISTS imagination_layers_layer_type_check;

ALTER TABLE imagination_layers
  ADD CONSTRAINT imagination_layers_layer_type_check
  CHECK (layer_type IN ('image', 'ai_generated', 'text', 'shape'));
