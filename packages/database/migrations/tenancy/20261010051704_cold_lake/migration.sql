ALTER TABLE "app"."delivery_attempts" ADD COLUMN "provider_response" text;
--> statement-breakpoint
GRANT UPDATE (provider_response) ON app.delivery_attempts TO pipong_worker;
