class ServerError extends Error {
  constructor(message, name) {
    super(message);

    this.name = name;
  }

  get reason() {
    return `${ this.name }: ${ this.message }`;
  }

};

module.exports = ServerError;
