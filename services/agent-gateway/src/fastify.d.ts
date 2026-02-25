import "fastify";

import {AuthContext} from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}
