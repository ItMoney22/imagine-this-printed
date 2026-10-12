-- Backfill metadata.model_id on the 71 unstamped on-person shots (task c7f6efdc).
--
-- The two-shot casting session, its reshoots and the Step Flow on-person path
-- never recorded which model drew a shot, so 71 of the 75 mockup_model_* rows
-- created since 2026-07-11 carried no metadata.model_id. Watchtower job
-- 20261007-td9c0e648 (Saturn) downloaded each file and read the signed C2PA
-- manifest inside it; its per-row table (jobs/saturn/20261007-td9c0e648-*
-- .previews/provenance-71.md) is the source for every row below. That table
-- lists 8-character id prefixes; each was resolved against the live rows on
-- 2026-10-12 and matched exactly one asset with the same product, role and
-- created time.
--
-- What gets written, per row (merged into metadata, nothing else touched):
--   model_id            google/nano-banana-2-lite (19 rows) or openai/gpt-image (52)
--   model_id_precision  'exact'  - the manifest names the model outright
--                       'vendor' - the manifest proves the vendor but carries no
--                                  model version, so model_id is the family only
--   model_id_likely     the best single guess at the exact model; when the
--                       guess is a tie it lists the candidates joined by '|'
--                       in chain order (2.5-flare is the head of the
--                       openai/gpt-image-2 chain, 2 the next link). Split:
--                       19 google/nano-banana-2-lite, 49 openai/gpt-image-2,
--                       3 'openai/gpt-image-2.5-flare|openai/gpt-image-2'.
--   model_id_basis      where the answer came from; always starts 'c2pa_manifest'
--
-- Idempotent: a row that already has a model_id is skipped, so this can never
-- overwrite a value a generator recorded, and a second run updates 0 rows.
-- A row deleted since the read (a reshoot replaces its slot with a new row,
-- which the generators now stamp themselves) simply has nothing to match.
--
-- Rollback:
--   UPDATE product_assets
--      SET metadata = metadata - 'model_id' - 'model_id_precision'
--                              - 'model_id_likely' - 'model_id_basis'
--    WHERE metadata->>'model_id_basis' LIKE 'c2pa_manifest%';

WITH lanes (lane, model_id, model_id_precision, model_id_likely, model_id_basis) AS (
  VALUES
    ('google',
     'google/nano-banana-2-lite', 'exact', 'google/nano-banana-2-lite',
     'c2pa_manifest (job 20261007-td9c0e648): signed by Google; google/nano-banana-2-lite is the only Google engine in the on-person path since 2026-07-27'),
    ('openai_likely_2',
     'openai/gpt-image', 'vendor', 'openai/gpt-image-2',
     'c2pa_manifest (job 20261007-td9c0e648): signed by OpenAI; the manifest carries no model version'),
    ('openai_2_or_flare',
     'openai/gpt-image', 'vendor', 'openai/gpt-image-2.5-flare|openai/gpt-image-2',
     'c2pa_manifest (job 20261007-td9c0e648): signed by OpenAI; the manifest carries no model version')
),
shots (id, product_id, lane) AS (
  VALUES
    ('ae35600e-0980-4760-9676-35f7305230e3'::uuid, 'c1e800bc-ffd5-4176-969c-3b5f910b4d06'::uuid, 'openai_likely_2'),  -- #1 mockup_model_1 2026-08-10 00:43 etsy
    ('bb16404e-79a6-4cb7-bd11-b3e566c99427'::uuid, 'c1e800bc-ffd5-4176-969c-3b5f910b4d06'::uuid, 'openai_likely_2'),  -- #2 mockup_model_2 2026-08-10 00:43 etsy
    ('5be8d1da-83e6-4570-98c7-b58c3fba9e56'::uuid, '37de52b0-c2eb-4b6a-be1a-1ad7a8e95025'::uuid, 'openai_likely_2'),  -- #3 mockup_model_2 2026-08-10 02:02 etsy
    ('95635a8f-3893-42e5-afe1-36ee006fa356'::uuid, '37de52b0-c2eb-4b6a-be1a-1ad7a8e95025'::uuid, 'openai_likely_2'),  -- #4 mockup_model_1 2026-08-10 02:02 etsy
    ('b8fbd94a-fe1a-462c-882a-6e05b45eac3e'::uuid, 'f09a7d64-a385-4a6c-9c75-aa8db0c5c569'::uuid, 'openai_likely_2'),  -- #5 mockup_model_2 2026-08-10 02:09 etsy
    ('2d31455f-b24c-4136-a7a6-3b6e285e3e6e'::uuid, 'f09a7d64-a385-4a6c-9c75-aa8db0c5c569'::uuid, 'openai_likely_2'),  -- #6 mockup_model_1 2026-08-10 02:09 etsy
    ('9500a57c-04fb-4787-82da-a28b789e64e4'::uuid, '2ba56b13-d2c5-4d95-be19-a873ca508e1d'::uuid, 'openai_likely_2'),  -- #7 mockup_model_1 2026-08-11 12:28 etsy
    ('6b4449a9-9da0-4062-9b5d-f6950a38f04a'::uuid, '2ba56b13-d2c5-4d95-be19-a873ca508e1d'::uuid, 'openai_likely_2'),  -- #8 mockup_model_2 2026-08-11 12:28 etsy
    ('1423a0a7-e441-46b7-b2fd-61cddc698c44'::uuid, '9d58d8b5-d828-4971-bdaa-318059bb5647'::uuid, 'openai_likely_2'),  -- #9 mockup_model_1 2026-08-11 12:29 etsy
    ('d29fcc8e-963b-4289-af91-7dfb3189c7f9'::uuid, '94323f18-9f93-48e0-84e0-94c246d62c5b'::uuid, 'openai_likely_2'),  -- #10 mockup_model_1 2026-08-19 20:13 etsy
    ('acd0a234-19fb-4527-a301-cef8e260fdce'::uuid, '94323f18-9f93-48e0-84e0-94c246d62c5b'::uuid, 'openai_likely_2'),  -- #11 mockup_model_2 2026-08-19 20:13 etsy
    ('ffdc693d-71db-4b3f-b2ff-a4ccadc8bec7'::uuid, '82eb70ef-964c-432e-a442-61657b606c78'::uuid, 'openai_likely_2'),  -- #12 mockup_model_2 2026-08-19 20:52 etsy
    ('41ec21dd-fe8c-4888-8b91-93c3f6d592c8'::uuid, '82eb70ef-964c-432e-a442-61657b606c78'::uuid, 'openai_likely_2'),  -- #13 mockup_model_1 2026-08-19 20:52 etsy
    ('947f816d-38e3-4b1d-8cf7-14576641b5e7'::uuid, '6c12fed9-74a7-432d-8651-4740740aef52'::uuid, 'openai_likely_2'),  -- #14 mockup_model_2 2026-08-20 15:15 etsy
    ('b0a312ba-0324-456f-8f2f-0abff961edc7'::uuid, '6c12fed9-74a7-432d-8651-4740740aef52'::uuid, 'openai_likely_2'),  -- #15 mockup_model_1 2026-08-20 15:15 etsy
    ('6ea8407c-5631-4f0b-b2a2-2d6d2345aced'::uuid, '4ecb90c1-ee12-47a5-a9ff-3858668bd762'::uuid, 'openai_likely_2'),  -- #16 mockup_model_2 2026-08-20 15:18 etsy
    ('108f7b87-b2c5-4bb6-9e70-25a8fe396fbb'::uuid, '4ecb90c1-ee12-47a5-a9ff-3858668bd762'::uuid, 'openai_likely_2'),  -- #17 mockup_model_1 2026-08-20 15:18 etsy
    ('2f44734b-a4a8-43d8-a2cb-ec78469fe9eb'::uuid, 'c6421291-525f-4ed4-9ad6-d015e9b74862'::uuid, 'openai_likely_2'),  -- #18 mockup_model_2 2026-08-20 15:18 etsy
    ('b7aabd00-d751-4c07-a3a4-1b70b02bddb7'::uuid, 'c6421291-525f-4ed4-9ad6-d015e9b74862'::uuid, 'openai_likely_2'),  -- #19 mockup_model_1 2026-08-20 15:18 etsy
    ('a24851c9-b5e2-4d69-8636-a3562edc1f7c'::uuid, '08666029-f536-482e-977b-e5c6c80e9d42'::uuid, 'openai_likely_2'),  -- #20 mockup_model_2 2026-08-23 11:09 etsy
    ('500be03f-b904-4341-af32-9811b4d00efc'::uuid, 'c714b84f-6361-4ae2-9cf5-9e9fb0f018d0'::uuid, 'openai_likely_2'),  -- #21 mockup_model_2 2026-08-23 11:12 etsy
    ('feb1ee02-7678-40b5-a488-36c67a72a57c'::uuid, 'c714b84f-6361-4ae2-9cf5-9e9fb0f018d0'::uuid, 'openai_likely_2'),  -- #22 mockup_model_1 2026-08-23 11:12 etsy
    ('d98093e2-3351-4843-ac38-562bea6e998d'::uuid, '0e11e915-0b90-4f1d-88eb-734250eba86c'::uuid, 'openai_likely_2'),  -- #23 mockup_model_2 2026-08-23 11:22 etsy
    ('16a818c6-06a0-4a56-a383-b8e411fd115b'::uuid, '0e11e915-0b90-4f1d-88eb-734250eba86c'::uuid, 'openai_likely_2'),  -- #24 mockup_model_1 2026-08-23 11:22 etsy
    ('6db1cc57-d0e3-496f-b2ef-9930116932b3'::uuid, '693f33aa-c3d2-4e96-9279-b86663472251'::uuid, 'openai_likely_2'),  -- #25 mockup_model_2 2026-08-23 11:44 etsy
    ('c0d68978-f36d-4d5d-8fb2-cf11602741ee'::uuid, '693f33aa-c3d2-4e96-9279-b86663472251'::uuid, 'openai_likely_2'),  -- #26 mockup_model_1 2026-08-23 11:44 etsy
    ('6b79a62c-082d-4d85-aea0-7220edeb20e1'::uuid, 'd75ff5ef-693b-4731-9c26-2737ef37a634'::uuid, 'openai_likely_2'),  -- #27 mockup_model_1 2026-08-24 11:09 etsy
    ('db717b03-dd95-461e-a949-6c4b98fd73fb'::uuid, 'd75ff5ef-693b-4731-9c26-2737ef37a634'::uuid, 'openai_likely_2'),  -- #28 mockup_model_2 2026-08-24 11:09 etsy
    ('73787cb2-9db2-4ae6-8cb1-a155b5d3fec0'::uuid, '66e16fd3-a46e-4523-8953-67943e1980db'::uuid, 'openai_likely_2'),  -- #29 mockup_model_2 2026-08-24 11:10 etsy
    ('9e6ceb85-aec0-4d22-85e6-bfaca40d06b0'::uuid, '868b54ed-1568-473e-a508-5e850fdd965b'::uuid, 'openai_likely_2'),  -- #30 mockup_model_1 2026-08-24 11:10 etsy
    ('4d46b30c-afee-4122-9b09-a69f12b27a63'::uuid, '3174dde7-19cd-4d82-8b4d-3cebddc31a60'::uuid, 'openai_likely_2'),  -- #31 mockup_model_2 2026-08-24 11:25 etsy
    ('a1276da8-a78b-4a6f-b9ba-3ad2eedaa871'::uuid, '5e709831-ee65-4242-8e01-71dd6b74a5ec'::uuid, 'openai_likely_2'),  -- #32 mockup_model_1 2026-08-24 11:28 etsy
    ('17cadaa5-8234-4dfc-9967-ae805363b518'::uuid, 'b30b944c-e9bb-4e0a-af24-1724bd2a593b'::uuid, 'google'),  -- #33 mockup_model_1 2026-08-30 11:17 etsy
    ('a1e33b9f-8723-4b10-bc5e-72af28498dea'::uuid, 'b30b944c-e9bb-4e0a-af24-1724bd2a593b'::uuid, 'openai_likely_2'),  -- #34 mockup_model_2 2026-08-30 11:17 etsy
    ('2fd4c1c1-8e32-482b-8a36-687d061c35b5'::uuid, '6c0ea780-646f-42e4-a5af-363d604ac0fc'::uuid, 'openai_likely_2'),  -- #35 mockup_model_2 2026-08-30 11:18 etsy
    ('28650298-35ae-422c-9d7c-e88670040e24'::uuid, '6c0ea780-646f-42e4-a5af-363d604ac0fc'::uuid, 'google'),  -- #36 mockup_model_1 2026-08-30 11:18 etsy
    ('dbe542e0-033f-4bc3-a427-6bef5384dfc6'::uuid, '156c477d-d93d-43d3-a96c-fe8f9ceff5d1'::uuid, 'google'),  -- #37 mockup_model_1 2026-08-30 11:18 etsy
    ('949edecf-87ee-4b9c-8e00-656ebd720d60'::uuid, '156c477d-d93d-43d3-a96c-fe8f9ceff5d1'::uuid, 'openai_likely_2'),  -- #38 mockup_model_2 2026-08-30 11:18 etsy
    ('51295ffc-480c-43fa-9c03-70e68eb9a450'::uuid, 'c9c6a22f-2e4d-4735-bd30-a72e897052bb'::uuid, 'google'),  -- #39 mockup_model_2 2026-08-30 11:29 etsy
    ('46f64138-c543-4101-92cf-fd8958fd82dc'::uuid, 'c9c6a22f-2e4d-4735-bd30-a72e897052bb'::uuid, 'openai_likely_2'),  -- #40 mockup_model_1 2026-08-30 11:29 etsy
    ('f4e77a33-e397-466f-8c4d-21251ab99c84'::uuid, 'a119050d-e75e-4b77-aada-020a5be4479d'::uuid, 'google'),  -- #41 mockup_model_2 2026-08-31 11:16 etsy
    ('5b249dbd-8b79-49f9-84bd-42e997d24d7a'::uuid, 'a119050d-e75e-4b77-aada-020a5be4479d'::uuid, 'google'),  -- #42 mockup_model_1 2026-08-31 11:16 etsy
    ('bc25c607-bcdf-4e80-a6b8-340d7d85e951'::uuid, '5e19cb2a-8dff-425c-8043-28c2d351d384'::uuid, 'google'),  -- #43 mockup_model_2 2026-08-31 11:17 etsy
    ('8a03c8b9-e060-4f07-abd7-ade02b5fe064'::uuid, '5e19cb2a-8dff-425c-8043-28c2d351d384'::uuid, 'google'),  -- #44 mockup_model_1 2026-08-31 11:17 etsy
    ('661d41ec-8587-40c7-99b7-46504d7f9317'::uuid, '11047bd5-a5f3-4a79-9412-8412da9616d4'::uuid, 'google'),  -- #45 mockup_model_2 2026-08-31 11:30 etsy
    ('bd18b15c-b92d-4784-a388-0219ea658dd3'::uuid, '11047bd5-a5f3-4a79-9412-8412da9616d4'::uuid, 'google'),  -- #46 mockup_model_1 2026-08-31 11:30 etsy
    ('08d632ea-d593-4af1-a717-bea70088923e'::uuid, '4076ed74-803c-4a46-a050-199315fad7cd'::uuid, 'google'),  -- #47 mockup_model_2 2026-08-31 11:31 etsy
    ('69de6402-b5bb-43eb-8a56-097a38a189ec'::uuid, '4076ed74-803c-4a46-a050-199315fad7cd'::uuid, 'google'),  -- #48 mockup_model_1 2026-08-31 11:31 etsy
    ('63ce3f9d-14b2-47df-b944-3ba6e80a1f13'::uuid, '1f7305d0-5043-4f3c-b413-b420439fef05'::uuid, 'google'),  -- #49 mockup_model_2 2026-08-31 11:36 etsy
    ('fb2f6568-611d-4692-b9a2-711f2b4937b8'::uuid, '1f7305d0-5043-4f3c-b413-b420439fef05'::uuid, 'google'),  -- #50 mockup_model_1 2026-08-31 11:36 etsy
    ('feff2a2a-a787-452a-b32f-09219d8d7cf0'::uuid, '83e8cd90-05d9-47e9-a914-a3a07ec4a509'::uuid, 'google'),  -- #51 mockup_model_2 2026-08-31 11:45 etsy
    ('c9bd1dd0-7570-48f9-8909-a3d238336028'::uuid, '4c0ea310-088b-45cf-b8e4-a4fb7f731872'::uuid, 'google'),  -- #52 mockup_model_1 2026-09-01 23:00 step_flow
    ('16127c2c-2e4d-4177-a8ee-a45c342632dd'::uuid, '6e964ed3-59e8-4bfc-a204-f94a015c9c50'::uuid, 'openai_likely_2'),  -- #53 mockup_model_1 2026-09-02 06:50 step_flow
    ('500ee666-3ac3-49c8-ade8-f62c0fd9833d'::uuid, 'bec29f2d-e4f1-4322-9c51-59fe906ba95d'::uuid, 'openai_likely_2'),  -- #54 mockup_model_1 2026-09-02 06:52 step_flow
    ('f676e11b-30e3-45cb-83bb-e42402e0ec57'::uuid, '385df0ea-b6de-4d45-88b7-e33feb7ed821'::uuid, 'openai_likely_2'),  -- #55 mockup_model_1 2026-09-02 09:29 step_flow
    ('a07af383-9821-4262-a61b-360175dc7fab'::uuid, '83e8cd90-05d9-47e9-a914-a3a07ec4a509'::uuid, 'openai_likely_2'),  -- #56 mockup_model_1 2026-09-02 16:03 step_flow
    ('c973c0b1-bce2-4f5a-9e4f-323dd220220a'::uuid, '212b53fa-59cb-4699-9e01-238742647fef'::uuid, 'openai_likely_2'),  -- #57 mockup_model_1 2026-09-02 20:42 step_flow
    ('61e110c0-b5e1-4e30-a62d-17aa6a013b0f'::uuid, '5f60fbd0-8b3b-4be7-a5d8-52d96f724ee3'::uuid, 'openai_likely_2'),  -- #58 mockup_model_1 2026-09-02 22:41 step_flow
    ('385fecc8-d3c8-46e5-bf6b-c12a10f080cc'::uuid, '8e1a18a5-de2b-4e74-938e-aefd030e8c5e'::uuid, 'google'),  -- #59 mockup_model_1 2026-09-02 23:12 step_flow
    ('6702c69c-020a-47f4-99db-cf5b1647623e'::uuid, 'a1120d6e-56ae-40d9-b9dd-ac31eea2af46'::uuid, 'google'),  -- #60 mockup_model_1 2026-09-02 23:26 step_flow
    ('fe6fa90d-9bd9-4aaa-b832-422ed6f8d175'::uuid, '56d895e7-5f8a-4c59-911c-a49a423c59d0'::uuid, 'google'),  -- #61 mockup_model_1 2026-09-02 23:32 step_flow
    ('fa1deb7e-0c8a-4340-bbd7-e8d169387f2b'::uuid, 'b4cb3371-ffb0-4c4a-9f71-c7ce2dd66ed7'::uuid, 'openai_likely_2'),  -- #62 mockup_model_1 2026-09-08 09:56 step_flow
    ('749574a5-aad7-46de-add5-f13781a99b51'::uuid, 'b4cb3371-ffb0-4c4a-9f71-c7ce2dd66ed7'::uuid, 'openai_likely_2'),  -- #63 mockup_model_2 2026-09-08 09:59 step_flow
    ('0284503e-67d5-4a68-9d8f-702d2e8eb943'::uuid, '9d92b405-bbf1-492a-82b8-a349e02e6116'::uuid, 'openai_likely_2'),  -- #64 mockup_model_2 2026-09-08 10:35 step_flow
    ('9ec693b6-537f-4ab9-a484-adf912bb79df'::uuid, '9d92b405-bbf1-492a-82b8-a349e02e6116'::uuid, 'openai_likely_2'),  -- #65 mockup_model_1 2026-09-08 10:38 step_flow
    ('29a37df2-55fb-4efe-9c5e-783bd604d706'::uuid, '3a2bc1ae-5cbf-4dc6-918a-73aba98dd9f4'::uuid, 'openai_likely_2'),  -- #66 mockup_model_1 2026-09-08 10:45 step_flow
    ('be3c4573-2aef-40e3-b80b-0800449f47f1'::uuid, '756db3ed-b975-493c-b52e-30bd36794086'::uuid, 'openai_likely_2'),  -- #67 mockup_model_1 2026-09-08 10:47 step_flow
    ('197a4f1c-fe62-405d-bbb8-c64c193a13b1'::uuid, 'e8c4751a-59e8-4440-a34e-522f723c923f'::uuid, 'openai_likely_2'),  -- #68 mockup_model_1 2026-09-09 02:16 step_flow
    ('fc102482-a768-4f6f-9b2e-e570c4dbaf57'::uuid, '92dd5bb9-1c20-4239-8b34-1733a1ce6391'::uuid, 'openai_2_or_flare'),  -- #69 mockup_model_1 2026-09-09 14:18 step_flow
    ('2ea26e37-3cb5-4b51-9e78-fce2dd03d8e1'::uuid, '5651547f-e1c0-43f4-8175-cc2485f56914'::uuid, 'openai_2_or_flare'),  -- #70 mockup_model_1 2026-09-09 14:20 step_flow
    ('f00727fb-bd84-4bca-a90b-04437a6a3c3f'::uuid, '051e8aec-1b12-4b3a-8823-be3f35a9c608'::uuid, 'openai_2_or_flare')  -- #71 mockup_model_1 2026-09-11 09:39 step_flow
)
UPDATE product_assets pa
   SET metadata = COALESCE(pa.metadata, '{}'::jsonb) || jsonb_build_object(
         'model_id',           l.model_id,
         'model_id_precision', l.model_id_precision,
         'model_id_likely',    l.model_id_likely,
         'model_id_basis',     l.model_id_basis)
  FROM shots s
  JOIN lanes l ON l.lane = s.lane
 WHERE pa.id = s.id
   AND pa.product_id = s.product_id
   AND pa.asset_role LIKE 'mockup\_model\_%'
   AND COALESCE(pa.metadata->>'model_id', '') = '';
