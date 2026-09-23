import type { IncomingMessage, ServerResponse } from 'http';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { createApp } from '../src/bootstrap';

let cachedApp: NestExpressApplication | null = null;
let initPromise: Promise<NestExpressApplication> | null = null;

async function getApp(): Promise<NestExpressApplication> {
  if (cachedApp) return cachedApp;
  if (!initPromise) {
    initPromise = (async () => {
      const app = await createApp();
      await app.init();
      cachedApp = app;
      return app;
    })();
  }
  return initPromise;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const app = await getApp();
  const instance = app.getHttpAdapter().getInstance() as (
    req: IncomingMessage,
    res: ServerResponse,
  ) => void;
  instance(req, res);
}
