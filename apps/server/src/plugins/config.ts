import { loadApiConfig } from '@pipong/shared';
import { definePlugin } from 'nitro';

export default definePlugin(() => {
  loadApiConfig();
});
