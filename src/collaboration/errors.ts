export class CollaborationError extends Error {
  constructor(public readonly error_type: string, message: string, public readonly retryable = false) {
    super(message);
    this.name = "CollaborationError";
  }
}
