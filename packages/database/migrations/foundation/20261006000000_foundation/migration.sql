CREATE SCHEMA auth AUTHORIZATION pipong_migrator;
CREATE SCHEMA app AUTHORIZATION pipong_migrator;
CREATE SCHEMA pgboss AUTHORIZATION pipong_migrator;
REVOKE ALL ON SCHEMA auth, app, pgboss, pipong_migrations FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO pipong_api;
GRANT USAGE ON SCHEMA app, pgboss TO pipong_api, pipong_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE pipong_migrator IN SCHEMA auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pipong_api;
ALTER DEFAULT PRIVILEGES FOR ROLE pipong_migrator IN SCHEMA auth
  GRANT USAGE, SELECT ON SEQUENCES TO pipong_api;
ALTER DEFAULT PRIVILEGES FOR ROLE pipong_migrator IN SCHEMA app, pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pipong_api, pipong_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE pipong_migrator IN SCHEMA app, pgboss
  GRANT USAGE, SELECT ON SEQUENCES TO pipong_api, pipong_worker;
