export type AppConfig = ReturnType<typeof configuration>;

export default function configuration() {
  return {
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    api: {
      prefix: process.env.API_PREFIX ?? 'api',
      version: process.env.API_VERSION ?? '1',
    },
    database: {
      url: process.env.DATABASE_URL,
    },
    jwt: {
      secret: process.env.JWT_SECRET ?? 'change-me',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    },
    timezone: process.env.DEFAULT_TIMEZONE ?? 'Asia/Dhaka',
    cors: {
      origins:
        process.env.CORS_ORIGINS === '*' || !process.env.CORS_ORIGINS
          ? '*'
          : process.env.CORS_ORIGINS.split(',').map((s) => s.trim()),
    },
    throttle: {
      ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
      limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
    },
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
    swagger: {
      enabled: (process.env.SWAGGER_ENABLED ?? 'true') === 'true',
      path: process.env.SWAGGER_PATH ?? 'docs',
    },
  };
}
