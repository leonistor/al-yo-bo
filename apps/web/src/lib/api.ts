import { hc } from 'hono/client';

import type { AppType } from '@al-yo-bo/server';

/** Type-safe Hono RPC client. `AppType` is a type-only import across workspaces. */
export const api = hc<AppType>('/');
