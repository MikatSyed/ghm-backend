import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string | string[]>;
  productIds?: string[];
  requestId?: string;
}

interface ErrorBody {
  error: ApiError;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    const { status, body } = this.resolve(exception);
    body.error.requestId = request.id;

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} ${body.error.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} -> ${status} ${body.error.code}: ${body.error.message}`,
      );
    }

    response.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        return {
          status,
          body: { error: { code: this.codeFromStatus(status), message: res } },
        };
      }

      const obj = res as {
        message?: string | string[];
        error?: string;
        code?: string;
        fields?: Record<string, string | string[]>;
        productIds?: string[];
      };

      const messages = Array.isArray(obj.message) ? obj.message : undefined;
      const fields = obj.fields ?? this.fieldsFromValidationMessages(messages);
      const message = Array.isArray(obj.message) ? obj.message.join('; ') : obj.message ?? exception.message;

      return {
        status,
        body: {
          error: {
            code: obj.code ?? this.codeFromStatus(status, obj.error),
            message,
            ...(fields ? { fields } : {}),
            ...(obj.productIds ? { productIds: obj.productIds } : {}),
          },
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaKnown(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          error: {
            code: 'PRISMA_VALIDATION_ERROR',
            message: 'Invalid data provided to the database query.',
          },
        },
      };
    }

    if (exception instanceof Error) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        body: { error: { code: 'INTERNAL_ERROR', message: exception.message || 'Unexpected error' } },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } },
    };
  }

  private fromPrismaKnown(e: Prisma.PrismaClientKnownRequestError): { status: number; body: ErrorBody } {
    switch (e.code) {
      case 'P2002': {
        const target = (e.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
        return {
          status: HttpStatus.CONFLICT,
          body: {
            error: {
              code: 'UNIQUE_CONSTRAINT_VIOLATION',
              message: `Duplicate value for ${target}.`,
            },
          },
        };
      }
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          body: { error: { code: 'FOREIGN_KEY_VIOLATION', message: 'Related record not found.' } },
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          body: { error: { code: 'NOT_FOUND', message: 'Record not found.' } },
        };
      default:
        return {
          status: HttpStatus.BAD_REQUEST,
          body: {
            error: {
              code: `PRISMA_${e.code}`,
              message: e.message.split('\n').pop() ?? 'Database error',
            },
          },
        };
    }
  }

  private codeFromStatus(status: number, fallback?: string): string {
    const map: Record<number, string> = {
      400: 'VALIDATION_FAILED',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      408: 'TIMEOUT',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] ?? (fallback ? fallback.toUpperCase().replace(/\s+/g, '_') : 'ERROR');
  }

  private fieldsFromValidationMessages(
    messages: string[] | undefined,
  ): Record<string, string[]> | undefined {
    if (!messages || messages.length === 0) return undefined;
    const fields: Record<string, string[]> = {};
    for (const msg of messages) {
      const m = /^([a-zA-Z0-9_.]+)\s+(.*)$/.exec(msg);
      if (m) {
        const [, field, rest] = m;
        (fields[field] ??= []).push(rest);
      } else {
        (fields._ ??= []).push(msg);
      }
    }
    return fields;
  }
}
