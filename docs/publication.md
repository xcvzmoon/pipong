# Container publication prerequisites

Package metadata checked on 2026-10-12 with the repository owner's authenticated GitHub CLI.
All four packages exist and are private. GitHub's package API reports no linked
repository for `pipong-server`, `pipong-worker`, `pipong-migrate`, or
`pipong-database`.

The [v0.0.6 release run](https://github.com/xcvzmoon/pipong/actions/runs/38066800749)
passed integration and image installation gates. Registry login succeeded, but
the server image push failed with `denied: permission_denied: write_package`.
The current release workflow already requests `packages: write`, and the
Dockerfile labels each runtime image with this repository's source URL.
An existing package also needs to grant the workflow repository access.
See [GitHub's package access instructions](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

For each package, open its settings while signed in as the package owner:

- [Server settings](https://github.com/users/xcvzmoon/packages/container/pipong-server/settings)
- [Worker settings](https://github.com/users/xcvzmoon/packages/container/pipong-worker/settings)
- [Migrator settings](https://github.com/users/xcvzmoon/packages/container/pipong-migrate/settings)
- [Database settings](https://github.com/users/xcvzmoon/packages/container/pipong-database/settings)

Connect `xcvzmoon/pipong` to the package and grant that repository Write access
under Manage Actions access. Connecting a previously published package alone
does not automatically grant inherited permissions. Keep the current visibility
unless a public distribution decision has been made. Private GHCR installation
requires an identity with package read access.

On 2026-10-12, the owner reported adding the required Actions access to all four
packages. Repository linkage and Actions access are separate settings; the API's
remaining null repository field does not disprove that grant. The collaborative
browser could not inspect the authenticated settings, so the grant remains
owner-reported. A subsequent workflow push must verify publication.

When release execution is authorized:

1. Verify that the release tag still matches the checkout's package version.
   Do not move or replace an existing release tag.
2. Run the release workflow from its intended source revision, including its
   integration and clean-image gates before publishing.
3. Record all four registry digests and the hosted workflow URL.
4. Install using the published artifacts and separately provisioned secrets,
   without a repository checkout. Exercise migration, operator enrollment,
   database TLS, API liveness, worker startup, and drain/restart.

The existing v0.0.6 tag predates later application changes. Fixing its package
access does not publish the current checkout. No images were pushed, release
tags created, or visibility settings changed during this prerequisite audit.
