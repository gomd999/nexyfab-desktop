// OpenAPI 3.1 spec for the public NexyFab API. Served as JSON so the
// /api/docs viewer (Scalar / Swagger / etc.) can render it. Kept small —
// only the public-facing endpoints under /api/public/v1 are listed.

import { NextResponse } from 'next/server';

const SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'NexyFab Public API',
    version: '1.0.0',
    description:
      'Programmatic access to NexyFab projects, drawings, and AI-generated parts. ' +
      'Authenticate with a Personal Access Token from Settings → API keys.',
    contact: { name: 'NexyFab Support', email: 'nexyfab@nexysys.com' },
    license: { name: 'Proprietary' },
  },
  servers: [{ url: 'https://nexyfab.com', description: 'Production' }],
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/public/v1/projects': {
      get: {
        summary: 'List projects',
        description: 'Returns up to 100 most-recently-updated projects for the authenticated user.',
        tags: ['Projects'],
        responses: {
          '200': {
            description: 'Project list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    projects: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Project' },
                    },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
      post: {
        summary: 'Create a project',
        tags: ['Projects'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 200 },
                  shapeId: { type: 'string', maxLength: 100 },
                  materialId: { type: 'string', maxLength: 100 },
                  sceneData: { type: 'string', maxLength: 5_000_000 },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    createdAt: { type: 'integer' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid input' },
          '401': { description: 'Unauthorized' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Personal Access Token issued from Settings → API keys. Pass as ' +
          '`Authorization: Bearer <token>`.',
      },
    },
    schemas: {
      Project: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          shapeId: { type: ['string', 'null'] },
          materialId: { type: ['string', 'null'] },
          createdAt: { type: 'integer' },
          updatedAt: { type: 'integer' },
        },
      },
    },
  },
  tags: [
    { name: 'Projects', description: 'CAD project CRUD' },
  ],
};

export async function GET() {
  return NextResponse.json(SPEC, {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
