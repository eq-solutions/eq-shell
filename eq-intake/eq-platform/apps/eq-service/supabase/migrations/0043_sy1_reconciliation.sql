-- ============================================================
-- 0043_sy1_reconciliation.sql
--
-- Final data-hygiene pass after reconciling the EQ Solves
-- Service asset table against the live Delta Elcom master file
-- (Active Assets 8-04-2026 5-34-22 PM.xlsx, 4795 rows).
--
-- Findings (see audit-report-2026-04-15.md and the overnight
-- reconciliation notes):
--
--   1. Migration 0038 reassigned 377 assets from archived SY1
--      (47 Bourke Rd, Alexandria) to active SY3 based on the
--      site address. That was wrong — the live system has those
--      assets on SY1 (639 Gardeners Rd, Mascot). They need to
--      move to active SY1.
--
--   2. Of the 377, three are day-one demo rows that do not
--      exist in the master file at all and should be hard-
--      deleted: NSX-SY1-001, PDU-SY1-001, UPS-SY1-001.
--
--   3. Four more demo/orphan rows exist elsewhere and also do
--      not appear in the master file: ACB - SY1 (maximo 1234)
--      on SY2, ACB-SY1-001 on SY2, ACB-SY4-001 and ACB-SY4-002
--      on SY4. Hard-delete.
--
--   4. 374 of the remaining ex-SY1 assets move SY3 -> SY1.
--      (377 moved by 0038, minus 3 demos deleted here.) Every
--      id in the move list was confirmed present in both the
--      DB and the master file with identical (name, maximo_id).
--
-- Post-state must match the master file exactly:
--
--   SY1 = 374   (was 0)
--   SY2 = 186   (was 188, -2 demos)
--   SY3 = 869   (was 1246, -374 moved, -3 demos)
--   SY4 = 109   (was 111, -2 demos)
--   All other sites unchanged.
--   Total active assets: 4721 (was 4728, -7 demos).
--
-- 84 SYD11 + 1 STG rows appear as drift vs. master but are
-- whitespace-only differences in the master export — left
-- alone intentionally.
--
-- Dependencies hard-deleted alongside the 7 demo assets:
--   acb_tests: 1 row
--   test_records: 1 row
--   (no readings, defects, check_assets, job_plan_items,
--    maintenance_check_items or nsx_tests depend on them.)
--
-- Safe to re-run: every step is idempotent (site_id updates
-- are keyed by id, deletes are keyed by id).
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Remove test data dependent on the 7 demo assets.
-- ------------------------------------------------------------
delete from public.acb_tests
where asset_id in (
  '4179e985-cd2e-4502-a6c1-0586d8832365',
  'a9dc95fe-d84f-4f65-802d-554075e5d9f8',
  '484e0566-a99e-4451-bc70-39a69b655623',
  'f06c6fc8-fe34-46a8-a4ea-97997c9f9b37',
  'e015e578-a75f-4cfc-bd09-ff9323a0260f',
  'eec1cd99-8ad1-4368-9156-6208fe32e62c',
  '0812f611-5a8f-4785-8067-025b375248cc'
);

delete from public.test_records
where asset_id in (
  '4179e985-cd2e-4502-a6c1-0586d8832365',
  'a9dc95fe-d84f-4f65-802d-554075e5d9f8',
  '484e0566-a99e-4451-bc70-39a69b655623',
  'f06c6fc8-fe34-46a8-a4ea-97997c9f9b37',
  'e015e578-a75f-4cfc-bd09-ff9323a0260f',
  'eec1cd99-8ad1-4368-9156-6208fe32e62c',
  '0812f611-5a8f-4785-8067-025b375248cc'
);

-- ------------------------------------------------------------
-- 2. Hard-delete the 7 demo/orphan assets.
--    (No entries in master file, all created 2026-04-08 as
--    pre-import seed rows.)
-- ------------------------------------------------------------
delete from public.assets
where id in (
  '4179e985-cd2e-4502-a6c1-0586d8832365', -- ACB - SY1  (SY2, orphan maximo 1234)
  'a9dc95fe-d84f-4f65-802d-554075e5d9f8', -- ACB-SY1-001 (SY2)
  '484e0566-a99e-4451-bc70-39a69b655623', -- ACB-SY4-001 (SY4)
  'f06c6fc8-fe34-46a8-a4ea-97997c9f9b37', -- ACB-SY4-002 (SY4)
  'e015e578-a75f-4cfc-bd09-ff9323a0260f', -- NSX-SY1-001 (SY3)
  'eec1cd99-8ad1-4368-9156-6208fe32e62c', -- PDU-SY1-001 (SY3)
  '0812f611-5a8f-4785-8067-025b375248cc'  -- UPS-SY1-001 (SY3)
);

-- ------------------------------------------------------------
-- 3. Move 374 assets SY3 -> active SY1
--    Active SY1: 2895df55-3585-4ba3-a015-7e0548dab228
--    Ids sourced from (name, maximo_id) match against master
--    file SY1 on 2026-04-16.
-- ------------------------------------------------------------
update public.assets
set site_id = '2895df55-3585-4ba3-a015-7e0548dab228',
    updated_at = now()
where id in (
  'a139bfc8-7ec0-46fe-926d-e1ba99a1381d',
  'd5804465-54bc-4c53-97b0-caa6a821123a',
  '00bee7b8-15c9-4c81-9a2d-d1416f765c75',
  'fe812d49-e445-4ccf-978e-8928cd8ebc5a',
  '9d280a9f-1037-4b09-9670-d2beae2a0f35',
  '462d9bf4-66b4-497d-959a-e041ad96a749',
  '8a4bc0d4-5d23-48dc-9e21-1344dd4ac158',
  'cab7d006-4bd1-4599-8d38-bdf1f93491bf',
  '383905a0-c825-4692-9d84-2b77a6dc00b0',
  'a225ea7a-ac06-47c3-a573-624560f44996',
  '8eca785b-3fd2-4323-bdea-f8e48e049551',
  '2df29f80-6ed8-4729-a671-e222ac3d5027',
  '7b22f657-d045-454a-b664-feae8fb6e16d',
  '962f171b-348e-437f-959f-51730e317005',
  '244d4c4b-b077-453b-abef-cbbfbb9d8667',
  '2df94683-fe87-4a3a-a21a-3e47da81133b',
  '87a50bfe-cbc1-47eb-8c83-5c953a94a94f',
  '8e925bee-b215-4666-ad9a-7445156c84fa',
  '88e3058f-a4cc-4ae4-b34c-568947aae8a6',
  '8ea32559-b066-4727-87de-e39c034c8111',
  '23799cad-506f-469c-b12d-fdecf4d32397',
  '53ad4a88-764d-464a-aada-8316c4e70fc7',
  'e42268b6-c164-4fd4-a6be-72d1aa095b0f',
  '64d90568-1f07-4530-8b41-c4db824f4d85',
  '0c54b57a-a1bf-498b-b61f-53257b98fcd3',
  'e12ed6da-dffe-4ceb-b435-bb3ffa4431f6',
  '5dd64597-8609-4f14-b34a-e39f2a15b0be',
  '2ae37335-a1e8-4c58-a692-b76fba832226',
  '95ce6fd8-ebab-4764-a1c7-84c8517536ab',
  '1576c89d-bc27-4b77-afd9-1982a3a03843',
  'b1fde915-14ac-4fe6-b597-d11481070d92',
  'cf9e885c-ea12-4479-b94d-1fcac0453faf',
  '2aba4017-af2b-40f0-bb2b-d9d9de77eb55',
  '7b999155-b060-45c3-bae1-c62f05ee4347',
  '73c4e75b-00de-446d-b335-99cc71653168',
  'cb7cad71-e6b7-49b4-a2c5-b2147b45f4ab',
  '55cdace6-8508-431e-ab4f-ccdbcd06ae90',
  'b387d2fe-08b6-43f7-b9d8-261ddb2f6e8a',
  'c641b0d2-5d74-4da1-b73d-89e927be558f',
  '52100507-f049-4aa6-a9fb-008e5193a25b',
  '5eb6f488-07a5-4f6e-94cf-2dd0df4b2bb5',
  '66cbf9b6-92da-42cd-ba5b-30913367df9f',
  '28f4c1bb-664b-40fa-a823-7ddad69d3d1e',
  'ae1004d6-a6da-426e-a61f-6c82459359d1',
  '49322d48-574f-4679-9301-0dfc34384ca3',
  '62d96cd8-d8d4-40ac-a622-7ed9f8ce6104',
  'ad0d402b-1ac7-4216-960a-e1af52f12867',
  'eb55d0cd-3465-4b61-8e9d-0f1783ef814e',
  'a84028fd-23ce-491b-8bf9-7fc2e5d576dd',
  '04fe0ea8-9d28-4a1e-89b6-44aacd662280',
  'cef55724-1a84-4fc7-a0f5-9167f126b2cf',
  'f792c424-7961-4eac-9fcb-38f684e38593',
  'c5075b80-5fa3-4cc4-910d-afc5b875c304',
  'aef4520c-67b6-4ded-8351-c28081325435',
  '4a7e12b4-08c1-4bef-991a-7c08e4e00b2d',
  '13923878-b026-4e30-9c27-d9537563a232',
  '1a47a378-5a71-48fa-98a0-f719dbaba12f',
  '1124dc93-0440-4da0-b3e7-e89d1f785f1c',
  '0e60c10b-39c1-4786-a0f2-eb3c3d474b62',
  'a97d10e8-4e73-4b6c-be35-c8e721f1f259',
  'a3867c43-4083-45e3-88e8-9bc88826e023',
  'afe5b901-6d27-4aa4-b195-91c8aa7830e9',
  '8b5a86b1-9a5a-46ae-9278-cd8041fb57ce',
  '0dd4999b-1bcf-4701-b778-ecad90f1da8b',
  '5b536c46-1013-4ade-9503-7349d7b94f03',
  '8c0d6f08-56a3-43ac-974a-c0cccc5e58a0',
  'c4dbfe27-4573-4978-b70a-4c8fbe416899',
  '4d08d79d-3acf-445c-9fbb-e78ecd114ef9',
  '1a5deb88-fac7-48a9-a059-162dcb08fdee',
  'ea38657b-6e3a-4cd5-ba00-7e4f0080dd9c',
  '54e469ad-9113-48c3-90a8-e0f5e5cde0b9',
  '8277a608-8f52-4610-8f0e-c6791bab9a29',
  'a9274e3d-f6a4-43bd-a0a3-9274386cc6db',
  'cc5c9c05-9f22-4f9b-bbbf-1ec5431250cc',
  '015ca4b9-e4c9-4aef-9b87-0b1a59048b5b',
  '3d46d961-2b56-4c09-b5f0-9ffb76fd5b06',
  '39627b72-d236-44c6-992e-a825971418cf',
  'df62ea92-e619-4056-a167-e29e62bdbf2e',
  '6d1196d9-8589-4b7f-80b0-9e596781c170',
  '0fecd67e-328b-4886-a707-1e21f10f3561',
  'ca61461f-e984-4040-b96c-842fac22ca8c',
  'fcc7e849-2d57-4556-935f-71931f77d685',
  'cf6e936f-f8ff-4b77-99d6-528487c38962',
  'e69afdb3-7184-4245-b8a8-d954165d9b56',
  '096de24b-3177-4636-9e6a-328d1100707e',
  '42b5eb70-f1e0-468c-ab5f-f9d5f3a4e201',
  '7aaf48b8-22e0-40e9-87a0-3d225dc6837f',
  'bcda3cd9-1892-4964-b15e-92879365e0bb',
  'edcdbe8e-01a6-4824-a5e7-6cc707393f27',
  'cdd66ebb-aa78-45f6-b412-182fc7bdf715',
  'c6a24390-a9ea-4fd4-a499-19d587435b01',
  'a7fbcddc-7edc-4537-b9d0-329fc4706a7c',
  '53b554fa-fd21-486a-92d3-673d3b151069',
  '6019147a-0b03-4454-af21-c7edab67d0fc',
  'a8f12d92-adae-450e-8f17-19655a37faf6',
  'c7b349e6-1a42-4729-ad18-e345f59ae772',
  '13902599-abcf-4bd1-ae06-2ab00b9eb00f',
  '0de78049-2f82-4956-aca6-59e3a08a7520',
  '73912432-b634-4001-bda2-556648723c6f',
  '0b1891e8-c8dc-40b1-9dc1-424c61b52696',
  '774004d3-4289-4ecb-8ceb-d2d6ce702405',
  '4c3b4cd1-2b83-43ac-9ded-7bb580245414',
  '3c0a13c8-f477-4e24-b715-abdf29f531c7',
  '18055e91-60ce-48e5-b9f3-eccfaedfc7ce',
  'd7a668a0-7d16-4f33-a522-b22056da9506',
  'f4924e2e-3a3a-4cd6-bce3-b498e141baeb',
  'da87a9c0-1ce3-4d76-8905-a365a8dbc4ae',
  'f6dcd7a8-bf8f-49f8-9743-d8c6dc3c9445',
  '8b3281ca-3b71-43d8-8710-9b5bfc5121aa',
  '697fdb7b-1260-41e9-9ca4-171a020983db',
  'c7899789-fce2-440d-86d9-8ff79e847193',
  'a24a5426-60fd-4adf-9d3b-bb3373cad56b',
  'a73187d6-a476-423c-ab27-ca9907a08a42',
  '2c2ad93d-9b4b-4522-9002-93fc9f8257a6',
  'a5bacc0b-c1d7-409b-81df-970be56fbe99',
  '1d81247c-b1df-4c1f-8d5d-05868905c527',
  '38b06e93-a986-4942-bd5f-fce04d1d0d6d',
  '253d4f1f-d10c-4703-87f6-6b73bec97b47',
  'ac0c1f89-ee66-41a8-85a8-2c8f1171af0e',
  '51504d57-cfe6-415c-a06b-13bc41327a97',
  'aaaffb63-2829-4461-ace5-64e75b0ff97c',
  'b8f44026-f580-4fcb-9d0e-bc79c9d5178a',
  'de8f0750-da36-4aec-9ff3-0dc0f156a871',
  '17c1b8ff-bc35-4246-98b8-5a7b6be8560e',
  'ce3d54d8-7e62-4568-b440-6a28828adbbc',
  '18b5110e-9903-4f12-832c-395183034fa6',
  '1a91eb37-015d-4b88-b730-b7b0476d2443',
  '5f6805be-862f-467a-bec7-cf923df184b8',
  'fcd4838a-77b8-4d59-8620-879d5e65b56e',
  'e2e857ac-d327-49a2-9935-dc92c763ba88',
  '257c0e56-302c-469f-a6fa-53a15860c1a1',
  '60c60227-a7e5-459b-bed8-bd0523a9b6a7',
  '43dfabb7-0750-47ef-8f11-ec597a5832ed',
  '6a13e660-ce5a-43da-8bc2-287afc170d4c',
  'cff37be0-2ae3-4c2f-9774-6362c49e0e69',
  '93c744ac-c06f-44ca-af3b-ebdd14a58df8',
  'ed2e45a2-248f-45d5-aad0-eebf0a782117',
  'b9b7ecd8-edd8-4b13-aa76-23672725810e',
  'd3eafadb-7b30-4078-a150-bfa3ee714876',
  '654bee72-6ba5-46c9-9323-53d2287643eb',
  '2e0fdb13-3064-4bb7-b86c-f6f4c3bb9a9b',
  'a9b64d11-e7df-4891-98d8-9501a77d550b',
  'fb5a2839-a290-44c7-954b-2c6e4c18d59e',
  '8867dd55-6284-468f-9f1c-a0cc041b4456',
  'bf54c770-91f0-42da-9b07-dbe36df70407',
  'dcd40dd7-50a1-4269-a044-da990138efa6',
  'c0dd1097-4c11-435c-8c40-09af2e52aa36',
  '78924d91-2820-4ee4-a140-259bd0a7ef3d',
  '45a49b02-77c4-40df-9654-cf30dd1bcb42',
  'a3d16ff8-3896-4ee2-8141-6229c0bd7f40',
  '38687814-2775-4fe9-a9cb-8b8874d415f5',
  '6977475f-ce65-4215-bf91-ecc424ef7a4c',
  '5ac90f50-afc5-4b5c-af9d-4179fb6ff767',
  'c343c4f8-6867-4175-a354-257a5ff80328',
  'd9bccf57-5ead-4695-9389-16a879c51f20',
  'c79f9784-8f80-42b0-8dbf-d11c9115def5',
  '6870af85-5277-4037-8e78-1196c902541e',
  '95f3552c-03ea-49d6-8406-d9a8985e41bf',
  '5c3f5f36-f081-4123-a244-fb1915ead7e2',
  '946a3d32-2752-4048-9830-2bd89b78c27d',
  'ecfa40ce-72dc-4534-be32-c65687e944dd',
  '72f074b6-0572-482a-ab1f-56a2b977f1cb',
  'f417f115-5016-4965-943f-996fed8261f3',
  '095e8302-b2f5-4df6-ab3f-697d529a32e1',
  '11aae426-8de6-4ac5-92b3-20dc55916b0f',
  '60e21c55-753e-4aa7-90dc-0e790f8b7a0c',
  'd3180e0e-6541-439b-b3c6-fb81a581a55c',
  '3348d5ed-852c-4846-862a-7d9b47a9992a',
  'e862d6a5-d39a-4450-8bab-8df6ca7057c7',
  'cbdc464a-8792-4f29-a703-023fcddd49ba',
  'e9bdc480-0d41-46bc-9329-a19f98950378',
  '3c4a62ad-d678-40bf-b5a8-8f04d0658556',
  '809f3d5e-657b-40a4-bb0c-fcc90ab5aa5d',
  '8fc5f7ea-680c-4830-90ff-139a72b95833',
  'd97b367d-7095-4143-8e98-9af525194935',
  '6cdf923d-a724-4c5f-a48b-5845a60972a6',
  '370552e0-9762-426c-9e57-924d54f76665',
  '2d7dc1f4-d4ba-4518-9757-6a959d95edc9',
  '20ee358a-5436-4292-a717-2f4e45be20b8',
  '2d15f534-aad8-4923-b1b3-2bb93a81ef32',
  '84aed1a8-0148-46c7-bb73-950543621f93',
  'fb2eae64-0284-47d2-b8a9-021478cfc3bf',
  '4f7aecea-7e1f-459d-818c-b3c667f3eaf5',
  '859d5511-b5f1-4b97-8294-7fdfad173947',
  '045a4cf3-7861-493f-a3ba-383802f32ed4',
  '5452341c-0b5f-4f97-a6d1-2be6a4d99d2c',
  '8fc7f9cd-40ed-46f8-9f70-c7ef15d2e7e3',
  '9b1edeca-55b3-45f9-88f5-8e653ee65f61',
  '7b20bc40-41b5-4e1c-a431-36adfcae474b',
  'cc5b6181-225d-4aa3-b79d-9a98ac7f62c8',
  '7ac88144-77b1-412f-b0a5-16ad03a206a5',
  '36601924-e901-41db-b066-d54deb12dbec',
  '4b29d76d-a0a2-46fc-b7a3-8d80bbf5c86a',
  '6a8de3d5-56b9-4258-ab8b-e4fe60a68a99',
  'a57c26ba-48cd-44c2-919d-b624e02b3bef',
  '673b7f7e-399c-46a1-85af-dfc3108676a7',
  '43c9fa79-b1dd-4ddd-a6cc-da65a32a4b5c',
  '7b5799cf-989b-4005-9e66-1bf13002b9f8',
  '261adef3-b671-45e1-a51c-f8f1c2dcb93a',
  '1677e3db-2402-4063-bf94-67191c5bedfb',
  'e5737d82-acbe-469a-ba87-8f63101d6914',
  '79c8b239-1372-42c2-baa6-3eded71ea1f2',
  '0d184f96-aa03-4e25-8cae-04739cd7d973',
  '056c5342-cd8c-4a1b-8f33-1f65b8f50d84',
  '09523efe-bbc6-4f41-b235-c822f5cc601c',
  '3d648d08-917b-4e4f-b14c-83f7e518d1aa',
  '5694a045-60c0-47c9-841e-e0ff0db114e7',
  '0d43c6e8-1655-4325-ace5-2867d13ee669',
  '827a1e7f-9e41-409d-bb85-75d89d6d063b',
  '56f4bba7-bc95-4a7c-9a66-7b709584f5b9',
  'e925c3fb-5861-42b7-b254-6837dc551c28',
  'c36ebfdb-92b0-4c6a-b3a0-e999e7775b95',
  '7c3d7be4-38c2-4a91-8b21-8d1a78552195',
  '80a22a08-643f-4f42-80a2-050fe8c606b4',
  '7193231e-fc91-4902-85c3-9f96d2a65cf2',
  'fd220a8a-aaa6-42f0-a0df-fa38c33499da',
  '039acd72-453c-41a4-8ca4-45fb47ff98d2',
  'fb7baf4a-afb9-4980-8ba1-a62bbb96b4c2',
  'e34e0698-4c2d-4293-be40-c54567ed17cd',
  '98b58ea1-4781-4330-b794-475af65e822f',
  '194a9dd0-89e0-4cca-aca4-e1a8a4c19969',
  'd6a3e325-6d0c-4ed6-b514-b294c2312db8',
  'ce2f9a1d-8548-42c0-a6ab-059b59359bf4',
  '3fcf84a0-7125-4b08-af49-4c4584458645',
  '9a75eab2-d2fa-4bce-a7c6-18e0e9739862',
  '91995795-a448-45f6-8570-1376dc9f5201',
  '1376391f-553e-4bc8-8bc8-095f629f63ff',
  '857d03d1-02e1-4244-913a-7d4a64ec80de',
  'eb91a635-2199-421f-89af-13b38bb973fa',
  '0527bdf1-8567-4829-b947-dd2b784e6983',
  'd7663af2-1cbb-4e2a-b862-181c84b4f3ea',
  '59d7cf33-c53e-4b44-98e9-bbe489ad5833',
  '9b2a8689-a0c3-4ce5-9923-abc017333c4b',
  '39a4c19d-f5ed-486d-ae6b-30822adec330',
  '4c3fdc14-b398-4903-bb15-ba1f882794e0',
  '827bcc8f-ac3d-4ded-842d-d7c10acc4225',
  '52258e5c-640a-4d35-9bdd-031b7905cee8',
  '2f7e61b4-c249-4270-bb10-8f192cc9a081',
  '6003f78a-2c40-47b0-8caa-a8b5c913e944',
  '0574f86b-1db4-4956-a02c-b63053b8ee38',
  '207aa9b9-d601-414c-a497-5e68f6506fb6',
  '57367263-950d-4ec4-877d-548768af8937',
  'd6568e14-5ae1-4607-921e-cece5d44147b',
  '808d026e-53fb-44db-970e-c8eeaaaee283',
  '13e9d657-1890-4e56-a352-66874b201272',
  'd55bfd99-6df4-4023-aaa9-4f2fcf556444',
  '333835aa-23b3-4b10-b43d-c01a04799308',
  'e580d015-c7ab-4204-bcf9-dac9cbb605da',
  '0122ebc5-e6e8-4983-a75f-b5dedb1308a5',
  '3cbeea27-bf5c-4e4a-8f20-2b1e4f2e8475',
  '8fa99dcb-6c2c-4cb0-a551-4fbe563b82c3',
  'f7fadd13-2b43-4483-8ef3-7532d6067d37',
  '0a868778-3cca-45d1-aa0d-e479de11ebd6',
  '28a32754-868d-48f4-ab6c-3ea5151b7f89',
  '37f1c15b-c328-46ee-9be9-6f773d6b724c',
  'bf8d3eac-d8f1-4869-adab-aee95be37a04',
  '0ed60d10-0680-40fb-98cb-0dcd319e3661',
  'f898d392-17a5-492f-81de-92b7e06f4219',
  'da12a034-cd67-4688-a626-f8910ff91437',
  '7d54fbf6-ad97-4fe8-9387-e70036f0b785',
  '2afb70e6-df86-41a9-912d-c95253def47e',
  '52bd5152-9f68-40ae-ab19-d680f852e529',
  '74ae9b1c-70e1-47c3-b229-4e606cbee402',
  '63bf7d85-4c90-4cde-985c-02f252f1cb8c',
  'f4fa1a6d-cd4e-4715-8131-25ae0ddcafe4',
  '8e22ead8-e02b-4e51-b6a9-afd537d3164d',
  '18ea9aab-fb91-490e-83fe-cd2d5f026c1f',
  '9ab8b856-037d-45f2-b835-b476eb82ff2b',
  'b14272a9-0cf5-4ac4-9847-570f9316d0e1',
  '6a3a1b46-78f8-4a28-a30a-fabbed1fbbe6',
  'e80e7421-bdc1-476a-b136-8b634b2ce1cd',
  '3d4bcd7e-6e3d-44c4-8ab6-b7c490820a66',
  '2df0224d-6d38-4d8d-a7cd-1f78c0357827',
  '952b5452-5a7b-4cea-b11d-393853035c06',
  'bada2a37-ae2e-43d1-bfbe-9c8fda36de1d',
  '9dbcb127-65c9-48f1-b752-a8f12619c105',
  'df1fc78b-d387-410a-86e4-2d467ed8f1a4',
  'c51ba917-645a-4cd2-a0ee-422ea06c1e56',
  '3b6be4c2-2aa8-4ffb-ac96-53a872744d16',
  'ca987a25-8d5e-4072-96eb-5a693c0762cf',
  '334450a7-78cd-4d4c-b3af-9e7c6da3d616',
  '11a7ab40-1567-4971-acfc-624cdb4d65ea',
  '48da849d-8322-4b27-bf60-ea2dd0a5d782',
  'c8b9f3c6-8530-4133-ba17-a14d66520314',
  '2810b972-a075-460a-a2cc-7eec03992713',
  'a191a4b4-eb13-4008-a986-4a0651366ffe',
  'd9f33fd4-90bd-4935-847e-c05b8e3f989c',
  'e2d8c65d-f227-4c3e-8a70-3ecc4a4c165c',
  'f3ac2a50-33d7-42a3-bd1d-39549cccfb8c',
  '36ac7c48-4414-4fb7-bac4-97e5ff693d62',
  '8b55e13f-3299-429f-b063-d6eeadd3065e',
  'c1a7711c-c6fc-4f90-ba89-37c971685269',
  'ee916b62-f909-4fd6-8df8-01a50da95b5a',
  '7d5b0b03-6fb9-47d0-b91b-202182bb5060',
  '705086db-ef2f-4614-92e1-87d950165281',
  '22c8df3c-2f99-4eb2-b6f2-7e2cf6a56795',
  '22e326e1-85f7-4648-8c3c-2765ece33ad3',
  'c55b3aef-cfef-47ab-8d1d-a4029af0faed',
  '57570888-ff2b-4538-99d1-9fb35de74dac',
  'e9d8480c-5d07-4f51-86bf-c3914ad81466',
  '84e63f93-2b09-4880-9e01-ab9d2e5d136e',
  '007dff7e-d2ea-46dd-9099-38ff0c2e5819',
  '65d651f9-c700-4e93-833b-2078a098923a',
  '2cc9236e-ae51-4529-9349-5d03ac5efea9',
  '0261f8d4-478d-4cbd-911c-dcbe07358e30',
  'e08d1380-7317-4138-8023-02049b9acb57',
  '69c8f6ae-1953-4c29-bbc3-4e4b7ebe0942',
  '1a9b42d6-8e7d-485b-ab21-e3681927ae51',
  'a51d6e13-a7ee-4b01-9a2c-658333243934',
  'c36a8021-55bb-4766-837b-1d15f05d2eda',
  'f2d2d6a9-225b-425d-9cfc-ae3c4f5def07',
  'd05a5207-af72-4ce6-8a19-a886cbed7989',
  '6b6fba22-c9cb-451a-8383-dde94f4ae858',
  '68e2b99e-960a-47ef-917f-9574ebf56acd',
  '5d0ac736-a796-4cad-b668-63bc9a734da0',
  '6801fd7a-a1ac-4851-b143-b51d6c82d9f4',
  '8493b703-eaf8-475c-ac3a-5074e8e7c904',
  '3ddd9962-a170-4061-82b8-f55939290701',
  '7f757936-27a8-4c8c-a012-fe0aa9bbc7b2',
  'f3c8672a-fc47-461b-8743-48d715e191b2',
  '64ddcaaf-48b0-4892-bd6b-fddc085ffd54',
  '3ce7464f-9375-492f-a464-0a118ce62b2f',
  '8aad7547-3757-4b39-9d3b-e39a9101ae27',
  '2e9466c1-35b4-4ee3-9835-83187b0c90b1',
  '1282d9d1-da3d-4a1b-8509-fdad7a6f468b',
  'ca3fc4ba-7702-4ef5-8889-8d6fd2a9bfa9',
  'e5132a69-4cb6-4b76-9c3f-7a3650717190',
  '9887eacf-3102-4cbf-aaa0-42afa910a797',
  '4e1fa380-b988-4146-bfef-d101cbf27bb9',
  '24fdd9af-5c1e-42f4-bc78-ce36409a29c3',
  '8f3a4cd1-02f8-4895-82a2-1d849f2b461a',
  '84297264-b593-41b4-b84b-fa74189b3f98',
  'f0df8d93-8e60-4d83-9040-37e6dfa5c82a',
  '6500580f-ecb7-4f73-b553-429247e76e67',
  'd4aeb5e4-a6d3-40c9-8ac7-8c4a39d7c9b6',
  '76b083cc-aa35-4270-b5e4-38fe0b6ea0d4',
  '15fd081a-aa28-48b5-b001-21109c4c297a',
  '3f3598ba-80dd-4d8a-907d-c48bd02487f7',
  'aec49777-8827-4477-a229-4ebc4ed68845',
  'fd953f25-10fb-4059-8d91-11e9a2d29836',
  '1951ed77-e3c0-4a7b-9bec-c312974cb20b',
  'ff4c353b-e4da-42e7-af2e-ef58de9b7cfe',
  '08884089-d076-409e-821b-9792f2dd55ac',
  '3baa8b6b-820a-4620-b9f2-9ddd940f1673',
  'f64b0a74-1ede-4b24-b85d-1604e70f8e52',
  '73ef790a-af04-46f7-9722-b42b552c7580',
  'e6b47668-0d14-40f0-9917-a6c6d3b8170a',
  'e07d9f60-e64b-4afc-96c1-b99b15d79383',
  '6ee5f1ae-76ec-4784-ac4e-98073b61f1e7',
  '62dac5a6-788c-42b4-afc2-14b8f14ad58c',
  'c2445bde-9c31-4347-a756-9a21e6922764',
  'b53b302e-a209-4afa-afa9-6de5f7ad739d',
  'b393a919-71fb-4276-a9b6-d96ff53cc03c',
  'ca4ded3b-e010-4172-b688-6d92c2bd3d41',
  '50e1c094-eeab-491e-a5f6-4945eac73fcc',
  '21ca87d5-6efc-4cb4-b26c-4686e0195e73',
  '35e7c2ed-4a7d-49f9-82eb-a33fe5473efa',
  'e48ca82f-2af0-4848-a16a-47f2e535b275',
  '50c01aa5-28b4-4a48-b709-f16291ce288c',
  '0dd756b7-4e99-465f-aac1-be3a11defa8e',
  '42d3eab6-f07a-46cd-957a-63be179d7b10',
  'a1bcdaf3-3fe0-4dfe-8fdf-b05b4e16c9bf',
  'ef5a0ce3-a222-45be-a01d-2d7c4609b667',
  'a893b7e4-45da-4891-b41b-dfd3bdfa578e',
  '31e2e339-81d4-4586-b86c-f5b43c07db37',
  'fb4376a0-c8ed-4b4d-a452-540141d06bc8',
  '81990634-26ba-4bc3-9920-aab846f243fd',
  'b5c53541-1034-445f-aae4-072de064494b',
  '5101dd01-5ced-4f81-8a1d-e6cd46d5bcb1',
  '917ff3d7-b3cd-4f2f-9d2d-1b30777ecace',
  '5b440ad4-4e04-4c56-86e2-247dbdfec59a',
  'be6db4d4-5d58-4daf-aaa3-6e50e11c7ccf',
  'fae416f6-0169-4b84-943c-2159c9c823ba',
  '1d7d0b6c-9c66-4082-ac4e-8bafc2f71e14'

);

-- ------------------------------------------------------------
-- 4. Sanity checks — raise if post-state does not match master.
-- ------------------------------------------------------------
do $$
declare
  sy1_count int;
  sy2_count int;
  sy3_count int;
  sy4_count int;
  total_count int;
  orphan_demos int;
begin
  -- Skip cleanly on fresh DB (CI integration tests) where the SKS tenant
  -- doesn't exist — the asset reconciliation was a one-shot historical
  -- operation against real data. Prod has the tenant; the guard is a no-op.
  if not exists (
    select 1 from public.tenants
     where id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'::uuid
  ) then
    raise notice '0043 sanity: SKS tenant absent (fresh DB) — skipping reconciliation checks';
    return;
  end if;

  select count(*) into sy1_count
    from public.assets a
    join public.sites s on s.id = a.site_id
    where s.code = 'SY1' and s.is_active and a.is_active
      and a.tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8';

  select count(*) into sy2_count
    from public.assets a
    join public.sites s on s.id = a.site_id
    where s.code = 'SY2' and s.is_active and a.is_active
      and a.tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8';

  select count(*) into sy3_count
    from public.assets a
    join public.sites s on s.id = a.site_id
    where s.code = 'SY3' and s.is_active and a.is_active
      and a.tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8';

  select count(*) into sy4_count
    from public.assets a
    join public.sites s on s.id = a.site_id
    where s.code = 'SY4' and s.is_active and a.is_active
      and a.tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8';

  select count(*) into total_count
    from public.assets a
    join public.sites s on s.id = a.site_id
    where a.is_active and s.is_active
      and a.tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8';

  select count(*) into orphan_demos
    from public.assets
    where id in (
      '4179e985-cd2e-4502-a6c1-0586d8832365',
      'a9dc95fe-d84f-4f65-802d-554075e5d9f8',
      '484e0566-a99e-4451-bc70-39a69b655623',
      'f06c6fc8-fe34-46a8-a4ea-97997c9f9b37',
      'e015e578-a75f-4cfc-bd09-ff9323a0260f',
      'eec1cd99-8ad1-4368-9156-6208fe32e62c',
      '0812f611-5a8f-4785-8067-025b375248cc'
    );

  if sy1_count <> 374 then
    raise exception '0043 sanity: SY1 expected 374, got %', sy1_count;
  end if;
  if sy2_count <> 186 then
    raise exception '0043 sanity: SY2 expected 186, got %', sy2_count;
  end if;
  if sy3_count <> 869 then
    raise exception '0043 sanity: SY3 expected 869, got %', sy3_count;
  end if;
  if sy4_count <> 109 then
    raise exception '0043 sanity: SY4 expected 109, got %', sy4_count;
  end if;
  if total_count <> 4721 then
    raise exception '0043 sanity: total active assets expected 4721, got %', total_count;
  end if;
  if orphan_demos <> 0 then
    raise exception '0043 sanity: demo assets still present, count=%', orphan_demos;
  end if;
end $$;

commit;
