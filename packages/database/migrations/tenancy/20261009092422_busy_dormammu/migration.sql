CREATE TABLE "app"."provider_budgets" (
	"provider" text PRIMARY KEY,
	"global_concurrency" integer NOT NULL,
	"tenant_concurrency" integer NOT NULL,
	CONSTRAINT "provider_budgets_provider_valid" CHECK ("provider" IN ('apns', 'fcm', 'web-push')),
	CONSTRAINT "provider_budgets_concurrency_bounds" CHECK ("tenant_concurrency" > 0 AND "global_concurrency" > "tenant_concurrency")
);

--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON app.provider_budgets FROM pipong_api, pipong_worker;
--> statement-breakpoint
INSERT INTO app.provider_budgets (provider, global_concurrency, tenant_concurrency) VALUES ('apns',16,4),('fcm',16,4),('web-push',16,4);
