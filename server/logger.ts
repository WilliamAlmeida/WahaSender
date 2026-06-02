import path from 'path';
import pino, { type DestinationStream, type StreamEntry } from 'pino';
import { config } from './config';

const isProduction = config.NODE_ENV === 'production';
const isTest = config.NODE_ENV === 'test';

function boolFromEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

const serviceName = process.env.SERVICE_NAME || 'wahasender';
const logDir = path.resolve(process.cwd(), process.env.LOG_DIR || 'storage/logs');
const logToFile = boolFromEnv(process.env.LOG_TO_FILE, !isTest);

const streams: StreamEntry[] = [];

if (!isTest) {
  if (isProduction) {
    streams.push({ stream: process.stdout });
  } else {
    streams.push({
      stream: pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }) as DestinationStream,
    });
  }
}

if (logToFile) {
  streams.push({
    stream: pino.destination({
      dest: path.join(logDir, `${serviceName}.log`),
      mkdir: true,
      sync: false,
    }),
  });
}

const destination: DestinationStream =
  streams.length > 1
    ? pino.multistream(streams)
    : streams.length === 1
      ? streams[0].stream
      : (process.stdout as DestinationStream);

export const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? 'silent' : isProduction ? 'info' : 'debug'),
  base: { service: serviceName },
}, destination);

export default logger;
