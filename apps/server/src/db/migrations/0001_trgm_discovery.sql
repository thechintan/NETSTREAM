CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channels_name_trgm_idx" ON "channels" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channels_title_trgm_idx" ON "channels" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "categories_name_trgm_idx" ON "categories" USING gin ("name" gin_trgm_ops);
