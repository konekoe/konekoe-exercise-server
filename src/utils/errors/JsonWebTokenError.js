class JsonWebTokenError extends require("./ServerError.js") {
  constructor(message = "Invalid token") {
    super(message, "TokenError");
  }
};

module.exports = JsonWebTokenError;
