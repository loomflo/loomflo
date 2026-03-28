import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { EventTypeSchema } from '../../types.js';
import type { Event } from '../../types.js';
import { queryEvents } from '../../persistence/events.js';
import type { EventQueryFilters } from '../../persistence/events.js';

// ============================================================================
// Types
// ============================================================================

/** Options accepted by the {@link eventsRoutes} factory. */
export interface EventsRoutesOptions {
  /** Return the absolute path to the current project workspace. */
  getProjectPath: () => string;
}

/** Shape of the GET /events JSON response. */
export interface EventsListResponse {
  /** Matching events after offset/limit pagination. */
  events: Event[];
  /** Total number of matching events before pagination. */
  total: number;
}

// ============================================================================
// Request Schemas
// ============================================================================

/** Zod schema for GET /events query parameters. */
const EventsQuerySchema = z.object({
  type: EventTypeSchema.optional(),
  nodeId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create a Fastify route plugin that registers event log routes.
 *
 * - GET /events — query the event log with optional type/nodeId filtering and pagination.
 *
 * @param options - Callbacks that supply runtime data for the response.
 * @returns A Fastify plugin suitable for `server.register()`.
 */
export function eventsRoutes(options: EventsRoutesOptions): FastifyPluginAsync {
  const { getProjectPath } = options;

  const plugin: FastifyPluginAsync = async (fastify): Promise<void> => {
    /**
     * GET /events
     *
     * Query the event log with optional type and nodeId filters.
     * Supports offset-based pagination via `limit` and `offset` query params.
     * Returns 400 if query parameters fail validation.
     */
    fastify.get('/events', async (request, reply): Promise<void> => {
      const parseResult = EventsQuerySchema.safeParse(request.query);

      if (!parseResult.success) {
        await reply.code(400).send({
          error: 'Invalid query parameters',
          details: parseResult.error.issues,
        });
        return;
      }

      const { type, nodeId, limit, offset } = parseResult.data;

      const filters: EventQueryFilters = {};
      if (type !== undefined) {
        filters.type = type;
      }
      if (nodeId !== undefined) {
        filters.nodeId = nodeId;
      }

      const projectPath = getProjectPath();
      const allMatching: Event[] = await queryEvents(projectPath, filters);

      const total: number = allMatching.length;
      const paginated: Event[] = allMatching.slice(offset, offset + limit);

      const response: EventsListResponse = { events: paginated, total };
      await reply.code(200).send(response);
    });
  };

  return plugin;
}
