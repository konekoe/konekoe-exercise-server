const { generalLogger } = require("konekoe-server-log");
const { MessageError } = require("./errors");
const handlers = require("../handlers");
const EventEmitter = require("events");
const ErrorHandler = require("./ErrorHandler.js");

class MessageHandler extends EventEmitter {
  constructor(sock) {
    super();

    this.sock = sock;
    this.logger = generalLogger;
    this.msgQueue = [];
    this.connected = false;
    this.parseMsg = this.parseMsg.bind(this);
    this.resolveMsg = this.resolveMsg.bind(this);
    this.emptyQueue = this.emptyQueue.bind(this);
    this.isClosed = this.isClosed.bind(this);
    this.close = this.close.bind(this);

    for (let key in handlers) {
      this[key] = handlers[key].bind(this); 
    }

    sock.on("message", this.parseMsg );
    sock.on("close", this.close);
  }

  handleError(err) {
    this.logger.serverError(`${ err.name }, ${ err.stack }`);
    return ErrorHandler(err);
  }

  parseMsg(msg) {
    try {
      this.handleMsg(JSON.parse(msg));
    }
    catch (err) {
      this.logger.debug(err.stack);

      return this.sendMsg({ error: this.handleError(new MessageError("Could not parse message")) });
    }
  }

  async resolveMsg(parsedMsg) {
    let result = { type: parsedMsg.type };


    try {
      if (this[parsedMsg.type]) {
        //Can be null
        const { error, ...rest } = await this[parsedMsg.type](parsedMsg.payload);

        if (error)
          result.error = this.handleError(error);
            
        result.payload = rest;
      }
      else {
        throw new MessageError(`Invalid message type ${ parsedMsg.type }`);
      }
    }
    catch (err) {
      result.error = this.handleError(err);
    }

    return result;
  }

  async handleMsg(parsedMsg) {
    let result = await this.resolveMsg(parsedMsg);

    if (result.payload || result.error)
      this.sendMsg(result);
  }

  send(type, payload) {
    this.sendMsg({ type, payload });
  }

  sendMsg(obj) {
    this.logger.debug(`Sending ${ obj.type }`);
    this.sock.send(JSON.stringify(obj));
  }

  isClosed() {
    return this.sock.readyState === 3;
  }

  emptyQueue() {
    let timer = setInterval(() => {
      if (this.msgQueue.length) {
        return this.handleMsg(this.msgQueue.shift());
      }

      this.logger.debug("Queue empty");

      clearInterval(timer);
    }, 1000);
  }

  async close(cb) {
    const self = this;

    return new Promise(async resolve => {
      await self.sock.close();
      return resolve(self.emit("close"));
    });
  }

};

module.exports = MessageHandler;
