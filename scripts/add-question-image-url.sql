-- Question image support (legacy app had imageUrl per question)
ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Backfill from migration archive (imageUrl stored in Question_extras)
UPDATE "Question" q
SET image_url = NULLIF(TRIM(a.payload->>'imageUrl'), '')
FROM "_MigrationArchive" a
WHERE a.source_table = 'Question_extras'
  AND a.source_id = q.id
  AND (q.image_url IS NULL OR TRIM(q.image_url) = '')
  AND a.payload->>'imageUrl' IS NOT NULL
  AND TRIM(a.payload->>'imageUrl') <> '';

-- Backfill from legacy camelCase column when present on same database
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Question' AND column_name = 'imageUrl'
  ) THEN
    EXECUTE $sql$
      UPDATE "Question"
      SET image_url = COALESCE(NULLIF(TRIM(image_url), ''), NULLIF(TRIM("imageUrl"), ''))
      WHERE "imageUrl" IS NOT NULL AND TRIM("imageUrl") <> ''
        AND (image_url IS NULL OR TRIM(image_url) = '')
    $sql$;
  END IF;
END $$;
