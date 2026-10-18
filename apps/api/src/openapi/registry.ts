import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

export const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string(),
      details: z.array(z.object({ path: z.string().optional(), message: z.string(), code: z.string().optional() })),
    }),
  }),
);

registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });

export function generateOpenApi(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Egyptian B2C E-Receipt Platform API',
      version: '1.0.0',
      description:
        'Versioned REST API. All monetary values are decimal strings. ETA status fields reflect the Egyptian Tax Authority ' +
        'processing result and are distinct from internal transaction status.',
    },
    servers: [{ url: '/api/v1' }],
  });
}
