const { MessageError } = require("../utils/errors");
const { GRADER_EXTERNAL_TIMEOUT } = require("../utils/Config.js");
const InternalError = require("../utils/errors/InternalError.js");
const { TimeoutError } = require("../utils/errors");
const services = { ...require('../services').messages, ...require('../services').containers };
//-------------------------------------------Helpers-------------------------------------


//------------------------------------Handlers---------------------------------------

// This handler will always return a payload containing at least the id of the variant.
async function code_submission({ exerciseId, files }) {
  this.logger.serverInfo("Received code submission.");

  const handleError = (error) => {
    return {
      exerciseId,
      points: 0,
      maxPoints: 0,
      error
    };
  };

  try {
    const filesObj = services.clientFilesToServerFiles(files);

    try {
      // 1. Check id of target exercise variant. If the id isn't valid, throw a MessageError
      var variantDbId = this.variantMap[exerciseId].id;
  
      if (!variantDbId)
        throw new MessageError("Invalid exercise.");
  
      this.logger.debug(`Variant db id is: ${ variantDbId }`);
    }
    catch (err) {
      this.logger.serverInfo(err.message);
      return handleError(new MessageError("Invalid exercise."));
    }
  
    try {
      // 2. Fetch the variant grader path from the database.
      var variantGraderPath = await services.getVariantPath(variantDbId);
      this.logger.debug(`Grader path is ${ variantGraderPath }`);
  
      await services.runCopyContainer(this.studentId, this.examCode);
  
    }
    catch (err) {
      await services.saveGraderResults(this.studentDbId, this.examDbId, this.exerciseConfigDbId, variantDbId, filesObj, null, err);
      this.logger.serverError(err.stack);
      return handleError(err);
    }
  
    try {
      // 3. Create a grader container.
      var graderContainer = await services.createContainer(this.studentId, this.examCode, variantGraderPath);
  
      // 4. Put the received files into the container at the variant path.
      this.logger.debug("Placing files in grader container");
      await services.putFilesToContainer(graderContainer, variantGraderPath, filesObj);
  
      // 5. Execute the exercise and pipe the containers stdout and stdin to the websocket.
      // 6. Wrap the execution in a 5 second timer and after 5 seconds kill the container.
      this.logger.debug("Running grader container");
      const graderStream = await services.attachToGrader(graderContainer);
  
      graderStream.on("data", (data) => {
        this.send("terminal_output", { exerciseId, data: data.toString() });
      });
  
      await graderContainer.start();
  
  
      // Grader containers have internal timeouts, and this external timeout produces an internal server error.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(async () => {
          this.logger.debug("Stopping grader container.");
          
          graderStream.removeAllListeners("end");

          try {
            await graderContainer.stop();
          }
          catch (err) {
            return reject(err);
          }
          
          return reject(new TimeoutError("Grader took too long."));
        }, GRADER_EXTERNAL_TIMEOUT);
  
        // Stream ends when container stops.
        graderStream.on("end", () => {
          this.logger.serverInfo("Grader finished.");
          clearTimeout(timer);
          return resolve();
        });
      });
      
      // 7. After the container stops, pull results from the variant path.
      const results = await services.getGraderResults(graderContainer, variantGraderPath);

      results.maxPoints = results.max_points;
  
      await  graderContainer.remove();
      // 8. Save the results to the database.
      await services.saveGraderResults(this.studentDbId, this.examDbId, this.exerciseConfigDbId, variantDbId, filesObj, results);
  
      // 9. Send points to the editor.
      return { ...results, exerciseId };
    }
    catch (err) {
      try {
        if (graderContainer)
        await  graderContainer.remove();
      }
      catch (err) {
        this.logger.debug("Container already removed.");
      }

      this.logger.serverError(err.message);
      await services.saveGraderResults(this.studentDbId, this.examDbId, this.exerciseConfigDbId, variantDbId, filesObj, null, err);
  
      return handleError(err);
    }
  }
  catch (err) {
    // If the database is misconfigured and results can't be saved, notify the user.
    this.logger.serverError(err.stack);

    return handleError(new InternalError("Something went wrong. Results could not be saved."));
  }
};

async function log_message({ message, level }) {
  this.logger[level](message);
  return null;
};

async function submission_fetch({ exerciseId, submissionId }) {
  this.logger.debug("Received submission fetch");

  try {
    const result = {
      exerciseId,
      submissionId,
      points: 0,
      files: [],
      date: new Date()
    };

    // No specific submission requested, return template files and the above default values.
    if (submissionId === "DEFAULT") {
      const variantDoc = await services.findVariant(this.variantMap[exerciseId].id);
      result.files = await services.variantFilesToJSON(variantDoc);
    }
    else {
      // Try to return files of requested submission.
      const submission = await services.findExerciseSubmission(submissionId);

      result.points = submission.points;
      result.date = submission.date;
      result.files = await services.parseSubmissionFiles(submission.submission);
    }

    return result;
    
  } catch (err) {
    // If the database is misconfigured and results can't be saved, notify the user.
    this.logger.serverError(err.stack);

    new InternalError("Something went wrong. Could not fetch submission.");
  }
};

module.exports = {
  log_message,
  code_submission,
  submission_fetch
}
