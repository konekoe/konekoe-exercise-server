class TimeoutError extends require("./ServerError.js") {
  constructor(reason) {
    super("Request timed out.", "TimeoutError");
    this._reason = reason;
  }

  get reason() {
    return `${ this.message }: ${ this._reason }`
  }
};

module.exports = TimeoutError;
