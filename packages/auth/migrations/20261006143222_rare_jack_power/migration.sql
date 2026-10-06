ALTER TABLE "auth"."account" DROP CONSTRAINT "account_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "auth"."invitation" DROP CONSTRAINT "invitation_organization_id_organization_id_fkey";--> statement-breakpoint
ALTER TABLE "auth"."invitation" DROP CONSTRAINT "invitation_inviter_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "auth"."member" DROP CONSTRAINT "member_organization_id_organization_id_fkey";--> statement-breakpoint
ALTER TABLE "auth"."member" DROP CONSTRAINT "member_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "auth"."session" DROP CONSTRAINT "session_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "auth"."two_factor" DROP CONSTRAINT "two_factor_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "auth"."account" ADD COLUMN "deleted_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "auth"."apikey" ADD COLUMN "deleted_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "auth"."invitation" ADD COLUMN "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."invitation" ADD COLUMN "deleted_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "auth"."member" ADD COLUMN "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."member" ADD COLUMN "deleted_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "auth"."organization" ADD COLUMN "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."organization" ADD COLUMN "deleted_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "auth"."rate_limit" ADD COLUMN "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."rate_limit" ADD COLUMN "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."rate_limit" ADD COLUMN "deleted_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD COLUMN "deleted_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "auth"."two_factor" ADD COLUMN "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."two_factor" ADD COLUMN "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."two_factor" ADD COLUMN "deleted_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "auth"."user" ADD COLUMN "deleted_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "auth"."verification" ADD COLUMN "deleted_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "auth"."account" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."account" ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."account" ALTER COLUMN "access_token_expires_at" SET DATA TYPE timestamp(3) with time zone USING "access_token_expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."account" ALTER COLUMN "refresh_token_expires_at" SET DATA TYPE timestamp(3) with time zone USING "refresh_token_expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."account" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."account" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."account" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth"."apikey" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."apikey" ALTER COLUMN "reference_id" SET DATA TYPE uuid USING "reference_id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."apikey" ALTER COLUMN "last_refill_at" SET DATA TYPE timestamp(3) with time zone USING "last_refill_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."apikey" ALTER COLUMN "last_request" SET DATA TYPE timestamp(3) with time zone USING "last_request" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."apikey" ALTER COLUMN "expires_at" SET DATA TYPE timestamp(3) with time zone USING "expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."apikey" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."apikey" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth"."apikey" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."apikey" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth"."invitation" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."invitation" ALTER COLUMN "organization_id" SET DATA TYPE uuid USING "organization_id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."invitation" ALTER COLUMN "expires_at" SET DATA TYPE timestamp(3) with time zone USING "expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."invitation" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."invitation" ALTER COLUMN "inviter_id" SET DATA TYPE uuid USING "inviter_id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."member" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."member" ALTER COLUMN "organization_id" SET DATA TYPE uuid USING "organization_id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."member" ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."member" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."member" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth"."organization" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."organization" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."organization" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth"."rate_limit" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."session" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."session" ALTER COLUMN "expires_at" SET DATA TYPE timestamp(3) with time zone USING "expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."session" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."session" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."session" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth"."session" ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."session" ALTER COLUMN "active_organization_id" SET DATA TYPE uuid USING "active_organization_id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."two_factor" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."two_factor" ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."two_factor" ALTER COLUMN "locked_until" SET DATA TYPE timestamp(3) with time zone USING "locked_until" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."user" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."user" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."user" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."verification" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "auth"."verification" ALTER COLUMN "expires_at" SET DATA TYPE timestamp(3) with time zone USING "expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."verification" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."verification" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth"."account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."member" ADD CONSTRAINT "member_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."member" ADD CONSTRAINT "member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;
