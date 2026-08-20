function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variable d'environnement manquante: ${name}`);
  return value;
}

export function config() {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.V5_PORT || 8788),
    appUrl: process.env.APP_URL || 'http://localhost:8788',
    timezone: process.env.APP_TIMEZONE || 'Europe/Paris',
    database: {
      host: required('DATABASE_HOST'),
      port: Number(process.env.DATABASE_PORT || 3306),
      database: required('DATABASE_NAME'),
      user: required('DATABASE_USER'),
      password: process.env.DATABASE_PASSWORD || ''
    },
    sessionSecret: required('SESSION_SECRET'),
    sessionTtlDays: Math.max(1, Number(process.env.SESSION_TTL_DAYS || 30))
  };
}

export function isProduction() {
  return (process.env.NODE_ENV || 'development') === 'production';
}
