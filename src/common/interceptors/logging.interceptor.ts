import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const started = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - started;
          this.logger.log(
            `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms${req.id ? ` [${req.id}]` : ''}`,
          );
        },
        error: () => {
          const ms = Date.now() - started;
          this.logger.warn(
            `${req.method} ${req.originalUrl} errored after ${ms}ms${req.id ? ` [${req.id}]` : ''}`,
          );
        },
      }),
    );
  }
}
