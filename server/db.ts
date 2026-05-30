import knex from 'knex';
import path from 'path';
import dotenv from 'dotenv';

// Garante o carregamento das variáveis de ambiente na raiz
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const client = process.env.DB_CLIENT || 'sqlite3';

const connectionConfig: any = client === 'sqlite3' 
  ? {
      filename: path.resolve(process.cwd(), 'storage', 'database.sqlite')
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
      database: process.env.DB_DATABASE || 'waha_sender',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    };

const config = {
  client: client === 'sqlite3' ? 'sqlite3' : 'pg',
  connection: connectionConfig,
  useNullAsDefault: client === 'sqlite3',
  pool: client === 'sqlite3' 
    ? {
        afterCreate: (conn: any, cb: any) => {
          // Habilita chaves estrangeiras no SQLite
          conn.run('PRAGMA foreign_keys = ON', cb);
        }
      }
    : {
        min: 2,
        max: 10
      }
};

export const db = knex(config);

export default db;
