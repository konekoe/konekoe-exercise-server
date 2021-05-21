class GraderError extends require("./ServerError.js") {
  constructor(reason) {
    super("Grader produced an error", "GraderError");

    this._reason = reason;
  }

  get reason() {
    return `${ this.message }: ${ this._reason }`;
  }

};

module.exports = GraderError;
