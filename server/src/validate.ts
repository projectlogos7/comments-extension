import { z, ZodError, type ZodTypeAny } from 'zod';
import { AppError } from './errors';

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  try {
    return schema.parse(data ?? {});
  } catch (e) {
    if (e instanceof ZodError) {
      const issue = e.issues[0];
      throw new AppError(400, 'validation_error', `${issue.path.join('.') || 'body'}: ${issue.message}`);
    }
    throw e;
  }
}

export { z };
