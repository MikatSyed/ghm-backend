import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request & { id?: string }, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
      const ua = req.header('user-agent') ?? '-';
      this.logger.log(
        `${req.ip} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms "${ua}"${
          req.id ? ` [${req.id}]` : ''
        }`,
      );
    });
    next();
  }
}
