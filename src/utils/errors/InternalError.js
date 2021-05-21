class InternalError extends require("./ServerError.js") {
  constructor(message = "Internal server error.", stack) {
    super(message, "InternalError");

    this.stack = stack || super.stack;
  }
};

module.exports = InternalError;
