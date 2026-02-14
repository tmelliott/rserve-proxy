import "fastify";

declare module "fastify" {
  interface Session {
    userId?: string;
    role?: "admin" | "user";
  }
}
