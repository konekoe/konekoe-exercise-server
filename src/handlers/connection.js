const { verifyToken } = require("konekoe-server-utils");
const { JsonWebTokenError, MessageError } = require("../utils/errors");
const InternalError = require("../utils/errors/InternalError.js");
const { JWT_PUBLIC, TOKEN_VERIFY_OPTIONS } = require("../utils/Config.js");
const services = require("../services").connection;

//-------------------------------------------Helpers-------------------------------------

// https://www.w3resource.com/javascript-exercises/javascript-math-exercise-23.php
const createUUID = () => {
  var date = new Date().getTime();
  var uuid = "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, function(char) {
      var rand = (date + Math.random()*16)%16 | 0;
      date = Math.floor(date/16);
      return (char == "x" ? rand :(rand & 0x3|0x8)).toString(16);
  });
  return uuid;
};

// variantMap = { <USER_SPECIFIC_VARIANT_ID>: <DB_VARIANT_ID> }
// For each variant fetch the description and files and return their contents as strings.
const createPayload = async (variantMap, submissions) => {
  try {
    const result = [];

    // uuid = USER_SPECIFIC_VARIANT_ID
    for (let uuid in variantMap) {
      const variant = await services.findVariant(variantMap[uuid].id);

      const variantSubmissionList = await services.findVariantSubmissionList(variant.id, submissions);

      let points = 0;
      let subs = [];

      if (variantSubmissionList) {
        points = Math.max.apply(null, variantSubmissionList.map(sub => sub.points)); // Find maximum received points.
        subs = variantSubmissionList.sort((sub1, sub2) => new Date(sub2.date) - new Date(sub1.date)) //Notice: Descending order
        .map(sub => sub._id.toString());
      }

      // TODO: Move this to the database and allow multiple configurations
      result.push({ 
        title: variant.name,
        id: uuid,
        points,
        description: variant.description,
        maxPoints: variantMap[uuid].maxPoints,
        submissions: subs
      });
    }

    return result;
  }
  catch (err) {
    return Promise.reject(new InternalError(err.message, err.stack));
  }
};

//------------------------------------Handlers---------------------------------------


// 1. Verify the user's identity.
// 2. Verify that the exam exists and is active.
// 3. Fetch or create student exercise result document.
// 4. Create a mapping from user specific ids to the exercise variant database ids.
// 5. Return list of exercises. 

async function server_connect({ token }) {
  this.logger.serverInfo("entered server_connect");

  this.logger.debug(token);

  if (!(token))
    return Promise.reject(new MessageError("Invalid payload."));

  try {
    const userInfo = verifyToken(token, JWT_PUBLIC, TOKEN_VERIFY_OPTIONS);

    this.logger.debug(`${ userInfo.studentId } connected.`);

    if (!userInfo|| (!userInfo.examCode) && (!userInfo.studentId))
      throw new JsonWebTokenError();

    const studentDoc = await services.findStudent(userInfo.studentId);

    if (!studentDoc)
      return  Promise.reject(new InternalError("No student found."));

    this.studentId = userInfo.studentId;
    this.studentDbId = studentDoc._id;

    const examDoc = await services.findExam(userInfo.examCode);

    if (!examDoc || (!examDoc.active && process.env.NODE_ENV !== "integration" ))
      return Promise.reject(new InternalError("Invalid exam."));

    this.examCode = userInfo.examCode;
    this.examDbId = examDoc._id;
    this.exerciseConfigDbId = examDoc.exerciseConfig;
    
    let exerciseResultDoc = await services.findExerciseResult(studentDoc._id, examDoc);

    // If a result doc is not found, create one.
    if (!exerciseResultDoc)
      exerciseResultDoc = await services.createExerciseResult(studentDoc._id, examDoc);

    const examExercises = await Promise.all(exerciseResultDoc.exercises.map(async ({ exercise, variant }) => ({ variant, exercise: await services.findExercise(exercise) })));

    // Create map of user specific ids to variant ids.
    this.variantMap = examExercises.reduce((acc, { variant, exercise }) => {
      acc[createUUID()] = { id: variant, maxPoints: exercise.points };
      return acc;
    }, {});

    this.exerciseResult = exerciseResultDoc;

    this.logger.debug("Creating connection payload.");

    const exercises = await createPayload(this.variantMap, this.exerciseResult.submissions);

    return { exercises } ;

  }
  catch (err) {
    return Promise.reject(err);
  }
};

module.exports = {
  server_connect
};
