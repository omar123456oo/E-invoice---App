/* Writes the OpenAPI document generated from the route definitions to docs/openapi.json. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.NODE_ENV ??= 'development';
process.env.MONGODB_URI ??= 'mongodb://unused';
process.env.JWT_ACCESS_SECRET ??= 'openapi-export-only-secret-0123456789abcdef';
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32).toString('base64');

const { createApp } = await import('../app.js');
const { generateOpenApi } = await import('../openapi/registry.js');
createApp();
const out = resolve(process.cwd(), '../../docs/openapi.json');
mkdirSync(resolve(out, '..'), { recursive: true });
writeFileSync(out, JSON.stringify(generateOpenApi(), null, 2));
console.log(`OpenAPI written to ${out}`);
