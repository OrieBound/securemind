/** Remove undefined values so Prisma Json fields accept the payload. */
export function jsonForPrisma<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
