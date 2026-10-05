# Pipong

API service for notifications, built with [Nitro v3](https://nitro.build), [h3](https://h3.dev), and [Rolldown](https://rolldown.rs).

## Implementation plan

The notification service design, scope, implementation phases, and release gates are in [the implementation plan](./brain/plans/01-notification-service/overview.md).

## Getting started

Use Node.js 24.x and pnpm 12.6.0, declared in `package.json`. `pnpm install` downloads the configured Node.js runtime when needed; CI reads the same `devEngines` declarations.

```bash
pnpm install
pnpm run dev
```

## Deploying

```bash
pnpm run check
pnpm run build
pnpm run preview
```

See the [Nitro deployment documentation](https://nitro.build/deploy) for deployment presets.

## Contributing

Read the [contribution guidelines](./CONTRIBUTING.md) and [Code of Conduct](./CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in the [security policy](./SECURITY.md).

## License

[MIT](./LICENSE.md)
