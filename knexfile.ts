import type { Knex } from 'knex';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const client = process.env.DB_CLIENT || 'sqlite3';

const config: { [key: string]: Knex.Config } = {
  development: {
    client: client === 'sqlite3' ? 'sqlite3' : 'pg',
    connection: client === 'sqlite3'
      ? {
          filename: path.resolve(__dirname, 'storage', 'database.sqlite')
        }
      : {
          host: process.env.DB_HOST || 'localhost',
          port: Number(process.env.DB_PORT) || 5432,
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD || 'password',
          database: process.env.DB_DATABASE || 'waha_sender',
        },
    useNullAsDefault: client === 'sqlite3',
    migrations: {
      directory: path.resolve(__dirname, 'server', 'migrations')
    }
  },
  production: {
    client: client === 'sqlite3' ? 'sqlite3' : 'pg',
    connection: client === 'sqlite3'
      ? {
          filename: path.resolve(__dirname, 'storage', 'database.sqlite')
        }
      : {
          host: process.env.DB_HOST || 'localhost',
          port: Number(process.env.DB_PORT) || 5432,
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD || 'password',
          database: process.env.DB_DATABASE || 'waha_sender',
        },
    useNullAsDefault: client === 'sqlite3',
    migrations: {
      directory: path.resolve(__dirname, 'server', 'migrations')
    }
  }
};

export default config;
