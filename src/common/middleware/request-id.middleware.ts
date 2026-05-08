import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';

const HEADER = 'x-request-id';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { id?: string }, res: Response, next: NextFunction): void {
    const incoming = req.header(HEADER);
    const id = incoming && incoming.length <= 128 ? incoming : uuid();
    req.id = id;
    res.setHeader(HEADER, id);
    next();
  }
}
