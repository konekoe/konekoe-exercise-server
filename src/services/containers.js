const { generalLogger } = require("konekoe-server-log");
const { 
  GRADER_RESULT_DIR, GRADER_CMD, GRADER_WORKING_DIR,
  GRADER_CONTAINER_IMAGE, GRADER_CONTAINER_VOLUMES, GRADER_INTERNAL_TIMEOUT,
  GRADER_ERROR_DIR
} = require("../utils/Config.js");
const { join } = require("path");
const { GraderError, TimeoutError } = require("../utils/errors");
const TarStreamer = require("../utils/TarStreamer.js");
const InternalError = require("../utils/errors/InternalError.js");

const containerSourceReplacer = (source, examCode, studentId) => source.replace("EXAMCODE", examCode).replace("STUDENTID", studentId.replace(/[^a-zA-Z0-9_.-]/g, "-"));

const runCopyContainer = async (studentId, examCode) => {
  try {
    generalLogger.debug("Running copy container.");

    const container = await process.graderDocker.createContainer({ 
      Image: "busybox",
      Mounts: GRADER_CONTAINER_VOLUMES.map(volumeInfo => { // Replace placeholders in student mount
        let copy = { ...volumeInfo };

        
        copy.Source = containerSourceReplacer(copy.Source, examCode, studentId);

        return copy;
      }),
      Cmd: ["cp", "-r", "/var/grader/", "/home/student/"],
    });

    await container.start();

    await container.wait();

    await container.remove();

    return;
  }
  catch (err) {
    return Promise.reject(new InternalError(err.message, err.stack));
  } 
}

const createContainer = async (studentId, examCode, variantPath) => {
  generalLogger.debug("Create grader container");
  
  return process.graderDocker.createContainer({ 
    Image: GRADER_CONTAINER_IMAGE,
    Mounts: GRADER_CONTAINER_VOLUMES.map(volumeInfo => { // Replace placeholders in student mount
      let copy = { ...volumeInfo };

      copy.Source = containerSourceReplacer(copy.Source, examCode, studentId);

      return copy;
    }),
    Cmd: GRADER_CMD || ["/bin/bash","/opt/grader/base-grader", join("/home/student/grader/", variantPath, "test"), GRADER_INTERNAL_TIMEOUT.toString()],
    WorkingDir: GRADER_WORKING_DIR || join("/home/student/grader/", variantPath, "test"),
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true
  });
};

const getGraderError = async (container) => {
  try {
    let stream = await container.getArchive({ path: join(GRADER_ERROR_DIR, "error.json") });
    const errorStr = (await TarStreamer.parseTarStream(stream))["error.json"];

    const errorObj = JSON.parse(errorStr);

    switch (errorObj.error_type) {
      case "RETTYPE":
        return new GraderError(errorObj.error_msg);
      case "TIMEOUT":
        return new TimeoutError(errorObj.error_msg);
      default:
        return new InternalError(errorObj.error_msg);
    }
  }
  catch (err) {
    // If error.json is not found, docker will return 404.
    if (err.statusCode === 404)
      return null;

    // If the error was not a 404 error then an internal server error has occured. 
    return Promise.reject(err);
  }
};

const getGraderResults = async (container, variantPath) => {
  try {
    generalLogger.debug("Fetching grader result");

    // Check wheter grader produced an error.
    const graderError = await getGraderError(container);

    if (graderError)
      return Promise.reject(graderError);

    // If grader didn't produce an error, check for grading results.
    generalLogger.debug(`GET RESULTS: ${ variantPath }`);
    stream = await container.getArchive({ path: join(GRADER_RESULT_DIR || join("/home/student/grader/", variantPath, "test"), "result.json") });
    const resultObj = await TarStreamer.parseTarStream(stream);

    return JSON.parse(resultObj["result.json"]);
  }
  catch (err) {
    return Promise.reject(new InternalError(err.message, err.stack));
  }
};

const putFilesToContainer = async (container, targetPath, files) => {
  try {
    generalLogger.debug(`PUT FILES: ${ targetPath }`);
    await container.putArchive(await TarStreamer.toBuffer(files), {
      path: GRADER_WORKING_DIR || join("/home/student/grader/", targetPath, "src")
    });


  }
  catch (err) {
    generalLogger.error(`PUT: ${ err.message }`);
    return Promise.reject(new InternalError(err.message, err.stack));
  }
};

const attachToGrader = async (container) => container.attach({
  Tty: false,
  stream: true,
  stdin: true,
  stdout: true,
  stderr: true
});

module.exports = {
  createContainer,
  runCopyContainer,
  getGraderResults,
  putFilesToContainer,
  attachToGrader
};