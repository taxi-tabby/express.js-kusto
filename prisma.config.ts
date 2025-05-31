import 'dotenv/config'
import type { PrismaConfig } from 'prisma'

export default {
  /**
   * Enable early access features for advanced Prisma functionality
   * This enables preview features and experimental capabilities
   */
  earlyAccess: true
} satisfies PrismaConfig