export class RuntimeInputError extends Error {
  readonly code = "invalid_input";

  constructor() {
    super("Invalid runtime task input");
    this.name = "RuntimeInputError";
  }
}

export class RuntimeClosedError extends Error {
  readonly code = "runtime_closed";

  constructor() {
    super("Runtime is no longer accepting tasks");
    this.name = "RuntimeClosedError";
  }
}
