import knex from 'knex';
import path from 'path';
import { config } from './config';
import { logger } from './logger';

const isSqlite = config.DB_CLIENT === 'sqlite3';

const connectionConfig: any = isSqlite
  ? {
      filename: path.resolve(process.cwd(), 'storage', 'database.sqlite'),
    }
  : {
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: config.DB_DATABASE,
      ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
    };

const knexConfig = {
  client: isSqlite ? 'sqlite3' : 'pg',
  connection: connectionConfig,
  useNullAsDefault: isSqlite,
  pool: isSqlite
    ? {
        afterCreate: (conn: any, cb: any) => {
          conn.run('PRAGMA foreign_keys = ON', cb);
        },
      }
    : {
        min: config.DB_POOL_MIN,
        max: config.DB_POOL_MAX,
      },
};

logger.info(
  { client: knexConfig.client, host: isSqlite ? connectionConfig.filename : connectionConfig.host },
  '[DB] Initializing database connection',
);

export const db = knex(knexConfig);

export const isPostgres = !isSqlite;
export const isSqliteDb = isSqlite;

export default db;
