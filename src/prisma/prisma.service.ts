import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';

const SLOW_QUERY_MS = 200;

function tunePoolUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  const sep = rawUrl.includes('?') ? '&' : '?';
  const extras: string[] = [];
  if (!/[?&]connection_limit=/.test(rawUrl)) extras.push('connection_limit=20');
  if (!/[?&]pool_timeout=/.test(rawUrl)) extras.push('pool_timeout=10');
  return extras.length ? `${rawUrl}${sep}${extras.join('&')}` : rawUrl;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const isProd = config.get<string>('app.env') === 'production';
    super({
      datasources: { db: { url: tunePoolUrl(config.get<string>('database.url') ?? '') } },
      log: isProd
        ? [
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
          ]
        : [
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'query' },
          ],
    });
  }

  async onModuleInit(): Promise<void> {
    // @ts-expect-error - $on('query') typing depends on log config
    this.$on('query', (e: Prisma.QueryEvent) => {
      if (e.duration >= SLOW_QUERY_MS) {
        this.logger.warn(`slow query ${e.duration}ms: ${e.query}`);
      }
    });
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }
}
