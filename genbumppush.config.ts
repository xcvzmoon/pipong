import { defineConfig } from 'genbumppush';

export default defineConfig({
  release: 'patch',
  github: {
    enabled: true,
  },
  docker: {
    enabled: true,
    tags: ['{{version}}', '{{tag}}'],
    images: [
      { source: 'pipong-server:{{version}}', image: 'ghcr.io/xcvzmoon/pipong-server' },
      { source: 'pipong-worker:{{version}}', image: 'ghcr.io/xcvzmoon/pipong-worker' },
      { source: 'pipong-migrate:{{version}}', image: 'ghcr.io/xcvzmoon/pipong-migrate' },
      { source: 'pipong-database:{{version}}', image: 'ghcr.io/xcvzmoon/pipong-database' },
    ],
  },
});
