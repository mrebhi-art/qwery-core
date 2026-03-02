import Mustache from 'mustache';

Mustache.escape = (value) => value;

export function renderTemplate<TContext extends object>(
  template: string,
  context: TContext,
): string {
  return Mustache.render(template, context);
}
