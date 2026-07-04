import type { FrontMatter } from '@timber/generator';
import type { ContentObject, ValidationResult } from './types.js';

/**
 * Resolve an object's visibility from its front matter. **Draft by default**
 * (settled decision): an object is private unless it explicitly sets `public: true`,
 * so nothing reaches the live site because a flag was forgotten.
 */
export function resolvePublic(data: FrontMatter): boolean {
  return data.public === true;
}

/** True if the object is marked public (SPEC §11's per-page public/private flag). */
export function isPublic(object: ContentObject): boolean {
  return object.public;
}

/**
 * Whether an object is *allowed* to be public: it must validate. This is the SPEC
 * §5 rule — "invalid content can always be saved as a draft, but a page cannot be
 * made public until it validates." The generator enforces this at build (Phase 6);
 * this surfaces the primitive.
 */
export function canPublish(validation: ValidationResult): boolean {
  return validation.valid;
}
