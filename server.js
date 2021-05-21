const { generalLogger } = require("konekoe-server-log");
const {
  PORT,
  DOCKER_HOST, DOCKER_CA_CERT,
  DOCKER_CLIENT_CERT, DOCKER_CLIENT_KEY,
  EXAM_DATABASE_URI, EXERCISE_DATABASE_URI
} = require("./src/utils/Config.js");
const { MongoConnection, examModels, exerciseModels } = require("konekoe-database");
const Docker = require("dockerode");
const WebSocket = require("ws");

process.READY_TO_EXIT = {
  error: false,
  examDb: false,
  exerciseDb: false,
  //wsServer: false,
  exitAttempts: 0,
  maxExitAttempts: 5,
  processIsReady() {
    return this.error || this.exitAttempts >= this.maxExitAttempts || ( this.examDb && this.exerciseDb );
  },
  update(key, state) {
    this[key] = state;

    if (this.processIsReady())
      console.log("Process is ready for a clean exit.");
  }
};

const main = async () => {
  try {
    process.examDb = await MongoConnection(EXAM_DATABASE_URI);
    generalLogger.serverInfo("Connected to exam database");
    examModels(process.examDb);
    process.READY_TO_EXIT.update("examDb", true);

    process.exerciseDb = await MongoConnection(EXERCISE_DATABASE_URI);
    generalLogger.serverInfo("Connected to exercise database");
    exerciseModels(process.exerciseDb);
    process.READY_TO_EXIT.update("exerciseDb", true);
  }
  catch (err) {
    generalLogger.serverError(err.stack);
    process.exit(1);
  }

  process.graderDocker = new Docker({
    protocol: "https",
    host: DOCKER_HOST,
    port: 2375,
    ca: DOCKER_CA_CERT,
    cert: DOCKER_CLIENT_CERT,
    key: DOCKER_CLIENT_KEY,
    version: "v1.40" // required when Docker >= v1.13, https://docs.docker.com/engine/api/version-history/
  });

  // Import message handler after database models have been registered.
  const { MessageHandler } = require("./src/utils");

  const exitHandler = async () => {
    if (!process.READY_TO_EXIT.processIsReady()) {
      generalLogger.serverInfo("Server state not yet ready to exit.");

      setTimeout(() => {
        process.READY_TO_EXIT.exitAttempts++;
        generalLogger.serverInfo(`${ process.READY_TO_EXIT.exitAttempts }/${ process.READY_TO_EXIT.maxExitAttempts } exit attempts made.`);
        process.emit("SIGHUP", 1);
      }, 5000);
      return;
    }


    generalLogger.debug("Signal received");

    //Close active connections.
    await Promise.all((Array.from(msgHandlers)).map(async s => s.close()));

    await new Promise(resolve => { return process.examDb.close(() => resolve(generalLogger.serverInfo("exam database connection closed."))) });
    await new Promise(resolve => { return process.exerciseDb.close(() => resolve(generalLogger.serverInfo("exercise database connection closed."))) });
    await new Promise(resolve => { return wss.close(() => resolve(generalLogger.serverInfo("WebSocket server closes."))) });
    await new Promise(resolve => { return wsServer.close(() => resolve(generalLogger.serverInfo("Https server closes."))) });

    process.exit(0);
  };

  ["SIGINT", "SIGHUP", "SIGTERM"].forEach((value) => process.on(value, exitHandler));
  

  generalLogger.debug("Server running...");

  const msgHandlers = new Set();


  var wss = new WebSocket.Server({ port: PORT });
  generalLogger.serverInfo(`WebSocket server listening on port ${ PORT }`);


  wss.on("connection", (sock, req) => {
    generalLogger.serverInfo(`${ (req) ? req.connection.remoteAddress : "Mock socket" } connected`);

    let newHandler = new MessageHandler(sock);

    msgHandlers.add(newHandler);

    newHandler.on("close", () => {
      generalLogger.serverInfo(`${ (req) ? req.connection.remoteAddress : "Mock socket" } disconnected`);
      msgHandlers.delete(newHandler);
      
    });
  });

  //These are mainly for registering TLS related errors.
  wss.on("error", (err) => {
    generalLogger.serverError(err.stack);
    process.READY_TO_EXIT.error = true;
  });

  /*
  wsServer.listen(PORT, () => {
    generalLogger.serverInfo(`WebSocket server listening on port ${ PORT }`);
    process.READY_TO_EXIT.update("wsServer", true);
  });
  */

  // Returns websocket server for testing purposes.
  return [wss, exitHandler, () => msgHandlers.size];
};


module.exports = main();