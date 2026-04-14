import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { Config } from "../../config.js";
import { ConfigSchema } from "../../config.js";
import type { ProjectRuntime } from "../../daemon-types.js";

// ============================================================================
// Types
// ============================================================================

/** Options accepted by the {@link configRoutes} factory. */
export interface ConfigRoutesOptions {
  /** Return the current merged configuration. */
  getConfig?: () => Config;
  /** Apply a partial config update and return the new merged configuration. */
  updateConfig?: (partial: Partial<Config>) => Config;
}

/** Shape of the GET /config JSON response. */
export interface ConfigResponse {
  /** The full merged configuration object. */
  config: Config;
}

/** Shape of the PUT /config JSON response. */
export interface ConfigUpdateResponse {
  /** The full merged configuration after applying the update. */
  config: Config;
}

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create a Fastify route plugin that registers configuration routes.
 *
 * - GET /config  -- returns the current merged configuration.
 * - PUT /config  -- validates and applies a partial configuration update.
 *
 * @param options - Callbacks that supply runtime config access.
 * @returns A Fastify plugin suitable for `server.register()`.
 */
export function configRoutes(options: ConfigRoutesOptions): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = (fastify): Promise<void> => {
    /**
     * GET /config
     *
     * Returns the current merged configuration object.
     */
    fastify.get("/config", async (request, reply): Promise<void> => {
      const rt = (request as FastifyRequest & { runtime?: ProjectRuntime }).runtime;
      const config: Config = rt ? rt.config : (options.getConfig?.() ?? ({} as Config));
      const response: ConfigResponse = { config };
      await reply.code(200).send(response);
    });

    /**
     * PUT /config
     *
     * Validates the request body as a partial config update using the
     * ConfigSchema. On success, merges the update into the current config
     * and persists the change. On failure, returns 400 with zod validation
     * details.
     */
    fastify.put("/config", async (request, reply): Promise<void> => {
      const parseResult = ConfigSchema.partial().safeParse(request.body);

      if (!parseResult.success) {
        await reply.code(400).send({
          error: "Invalid config",
          details: parseResult.error.issues,
        });
        return;
      }

      const rt = (request as FastifyRequest & { runtime?: ProjectRuntime }).runtime;

      let updated: Config;
      if (rt) {
        rt.config = { ...rt.config, ...parseResult.data };
        updated = rt.config;
      } else {
        const updateConfigFn = options.updateConfig;
        if (!updateConfigFn) {
          await reply.code(501).send({ error: "Config update not supported" });
          return;
        }
        updated = updateConfigFn(parseResult.data);
      }

      const response: ConfigUpdateResponse = { config: updated };
      await reply.code(200).send(response);
    });
    return Promise.resolve();
  };

  return plugin;
}
