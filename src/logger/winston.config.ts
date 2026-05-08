import { utilities as nestWinstonUtils } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

export function buildWinstonConfig(env: string, level: string): winston.LoggerOptions {
  const isProd = env === 'production';

  const consoleFormat = isProd
    ? winston.format.combine(winston.format.timestamp(), winston.format.json())
    : winston.format.combine(
        winston.format.timestamp(),
        winston.format.ms(),
        nestWinstonUtils.format.nestLike('GHM', {
          colors: true,
          prettyPrint: true,
        }),
      );

  const transports: winston.transport[] = [
    new winston.transports.Console({ format: consoleFormat }),
  ];

  if (isProd) {
    transports.push(
      new winston.transports.DailyRotateFile({
        dirname: 'logs',
        filename: 'app-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        zippedArchive: true,
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      }),
      new winston.transports.DailyRotateFile({
        dirname: 'logs',
        filename: 'error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '30d',
        zippedArchive: true,
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      }),
    );
  }

  return { level, transports };
}
