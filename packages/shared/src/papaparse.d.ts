declare module 'papaparse' {
  export interface UnparseConfig {
    columns?: string[];
    header?: boolean;
  }

  export interface ParseConfig {
    preview?: number;
  }

  export interface ParseMeta {
    delimiter?: string;
  }

  export interface ParseResult<T = unknown> {
    data: T[];
    errors: unknown[];
    meta: ParseMeta;
  }

  export function unparse(
    data: unknown[] | Record<string, unknown>[],
    config?: UnparseConfig,
  ): string;

  export function parse<T = unknown>(
    input: string,
    config?: ParseConfig,
  ): ParseResult<T>;

  const Papa: {
    unparse: typeof unparse;
    parse: typeof parse;
  };

  export default Papa;
}
