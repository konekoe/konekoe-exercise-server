class MessageError extends require("./ServerError.js") {
  constructor(message = "Invalid message") {
    super(message, "MessageError");
  }
};

module.exports = MessageError;
