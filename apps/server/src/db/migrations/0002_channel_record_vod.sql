ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "record_vod" boolean DEFAULT true NOT NULL;
