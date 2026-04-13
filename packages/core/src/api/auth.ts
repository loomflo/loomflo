import type { FastifyReply, FastifyRequest } from "fastify";
import type { preHandlerAsyncHookHandler } from "fastify/types/hooks.js";

/** Expected prefix for the Authorization header value. */
const BEARER_PREFIX = "Bearer ";

/**
 * Create a Fastify preHandler hook that validates Bearer token authentication.
 *
 * The returned hook extracts the token from the `Authorization` header,
 * compares it against the expected token, and responds with 401 if the
 * token is missing or invalid. The token is captured at creation time
 * (daemon startup) and not re-read from disk on each request.
 *
 * @param token - The valid auth token generated at daemon startup.
 * @returns A Fastify preHandler hook function.
 */
export function createAuthMiddleware(token: string): preHandlerAsyncHookHandler {
  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const header = request.headers.authorization;

    if (!header || !header.startsWith(BEARER_PREFIX)) {
      await reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    const provided = header.slice(BEARER_PREFIX.length);

    if (provided !== token) {
      await reply.code(401).send({ error: "Unauthorized" });
      return;
    }
  };
}
