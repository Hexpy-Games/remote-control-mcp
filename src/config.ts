/**
 * Configuration for the MCP + Auth server
 */

import 'dotenv/config';

export interface Config {
  port: number;
  baseUri: string;
  nodeEnv: string;
  redis: {
    enabled: boolean;
    url?: string;
    tls?: boolean;
  };
}

function loadConfig(): Config {
  return {
    port: Number(process.env.PORT) || 3232,
    baseUri: process.env.BASE_URI || 'http://localhost:3232',
    nodeEnv: process.env.NODE_ENV || 'development',
    redis: {
      enabled: !!process.env.REDIS_URL,
      url: process.env.REDIS_URL,
      tls: process.env.REDIS_TLS === '1' || process.env.REDIS_TLS === 'true'
    }
  };
}

export const config = loadConfig();

console.log('Configuration loaded:');
console.log('   Port:', config.port);
console.log('   Base URI:', config.baseUri);
console.log('   Redis:', config.redis.enabled ? 'enabled' : 'disabled');
console.log('');
