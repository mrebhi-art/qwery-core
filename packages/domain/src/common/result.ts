export class Result<TSuccess, TError> {
  private constructor(
    public readonly success: boolean,
    public readonly value?: TSuccess,
    public readonly error?: TError,
  ) {}

  public static ok<TSuccess, TError = never>(
    value: TSuccess,
  ): Result<TSuccess, TError> {
    return new Result<TSuccess, TError>(true, value);
  }

  public static fail<TSuccess = never, TError = unknown>(
    error: TError,
  ): Result<TSuccess, TError> {
    return new Result<TSuccess, TError>(false, undefined, error);
  }
}
