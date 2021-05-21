const { makeId, getRandomInt } = require("konekoe-server-utils");
const { Student, Exam, Config, Course } = process.examDb.models;
const { 
  ExerciseVariant, Exercise,
  ExamExerciseConfig, StudentExerciseResult,
  ExerciseSubmission 
} = process.exerciseDb.models;
const { GRADER_PATH } = require("../src/utils/Config.js");
const { writeFile, mkdir, rmdir } = require("fs").promises;

async function addStudent(studentId) {
  const newStudent = new Student({ studentId });
  return await newStudent.save();
};

async function addExam(examCode) {
  return await (new Exam({ examCode })).save();
};


// See konekoe-examsite
const createExerciseVariant = async (variant) => {
  try {
    const files = [];
    const paths = [];

    for (let fileId in variant.files) {
      const obj = variant.files[fileId];

      if (obj.file) {
        files.push(await processFile(obj.file));
      } 
      else {
        paths.push(obj.path);
      }
    }

    variant.files = files;
    variant.paths = paths;
    
    return (new ExerciseVariant(variant)).save();
  }
  catch (err) {
    return Promise.reject(err);
  }
};

const createExamExercises = async (exerciseConf) => {
  try {
    const exercises = [];

    for (let exerciseId in exerciseConf) {
      const variants = [];

      for (let variantId in exerciseConf[exerciseId].variants) {
        variants.push(await createExerciseVariant(exerciseConf[exerciseId].variants[variantId]))
      }

      exercises.push(await (new Exercise({ variants, points: exerciseConf[exerciseId].maxPoints })).save());
    }

    return exercises;
  }
  catch (err) {
    return Promise.reject(err);
  }
};

const createExamExerciseConfig = async (configObj) => (new ExamExerciseConfig({ exercises: await createExamExercises(configObj) })).save();

const createExam = async (exerciseConfig) => {
  let id = makeId(10);

  try {

    let exerciseConfigDoc = await createExamExerciseConfig(exerciseConfig);
    const course = await new Course({ courseCode: makeId(20) }).save();
    const config = await new Config({ examUrl: "test.fi", examStart: new Date(), examEnd: new Date() }).save();

    //Create exam document.
    let examDoc = new Exam({
      examCode: id,
      exerciseConfig: exerciseConfigDoc,
      active: true, // Only active exams can be connected to.
      // Required by database schema but unused in tests.
      startDate: new Date(),
      config,
      course
    });

    return await examDoc.save();
  }
  catch (err) {
    return Promise.reject(err)
  }
};

const createDir = (path) => mkdir(path);
const removeDir = (path, options = {}) => rmdir(path, options); 

const createTempDir = () => createDir(GRADER_PATH);
const removeTempDir = () => removeDir(GRADER_PATH, { recursive: true });
const addLocalFile = (path, content) => writeFile(`${ GRADER_PATH }/${ path }`, content);

// Either results or error != null but not both
const createSubmission = async (exerciseResult, variantId, files, points, message, date=new Date()) => {
  try {

    // Find submissions for the target variant.
    let variantSubmissionMap = exerciseResult.submissions.find( ({ variant }) => variant.toString() === variantId.toString() );

    // No submissions for this variant have been made yet.
    if (!variantSubmissionMap) {
      exerciseResult.submissions.push({ variant: variantId, submissions: [] });
      variantSubmissionMap = exerciseResult.submissions.find( ({ variant }) => variant === variantId );
    }

    
    const submissionDoc = await new ExerciseSubmission({
      points,
      submission: JSON.stringify(files),
      output: message,
      date
    }).save();

    variantSubmissionMap.submissions.push(submissionDoc);

    // Make sure that the submissions array is saved when the exercise result object is saved.
    exerciseResult.markModified("submissions");

    return await exerciseResult.save();
  }
  catch (err) {
    return Promise.reject(Error(err.message));
  }
};

const createExercises = async (numOfExercises, numOfVariants) => {
  try {
    const exerciseIds = Array(numOfExercises).fill("").map(v => makeId(20));
    const result = {};

    for (let exerciseId of exerciseIds) {
      result[exerciseId] = {
        maxPoints: getRandomInt(1, 100),
        variants: {}
      };

      const variantIds = Array(numOfVariants).fill("").map(v => `${ exerciseId }-${ makeId(20) }`);

      // Create 1-20 filepaths.
      const pathGenerator = (variantId) => Array(getRandomInt(1, 20)).fill("").map((v, index) => `${ variantId }-${ index }`);

      for (variantId of variantIds) {
        const paths = pathGenerator(variantId);

        // Add local files
        await Promise.all(paths.map(path => addLocalFile(path, `File at path ${ path }`)));

        result[exerciseId].variants[variantId] = {
          description: `Description of ${ variantId }`,
          name: `I am ${ variantId }`,
          files: paths.reduce((acc, curr, index) => {
            acc[`${ variantId }-file-${ index }`] = { path: curr };
            return acc;
          },{})
        }
      }
      
    }

    return result;
  }
  catch (err) {
    return Promise.reject(err);
  }
};

const checkSubmissionResultExists = async (exerciseResultId, variantId) => {
  try {
    const exResultDoc = await StudentExerciseResult.findById(exerciseResultId);

    let submissions = exResultDoc.submissions.find(map => map.variant.toString() === variantId.toString());

    submissions = await Promise.all(submissions.submissions.map(id => ExerciseSubmission.findById(id)));

    const newestDate = new Date(Math.max.apply(null, submissions.map(sub => sub.date))).getTime();

    return submissions.find(sub => sub.date.getTime() === newestDate);
  }
  catch (err) {
    return Promise.reject(err);
  }
};

const tempDataDirPath = (studentId, examCode) => `${ GRADER_PATH.replace(/\/$/, "") }-${ examCode }-${ studentId }-backup`;

const createTempDataDir = (studentId, examCode) => createDir(tempDataDirPath(studentId, examCode));
const removeTempDataDir = (studentId, examCode) => removeDir(tempDataDirPath(studentId, examCode), { recursive: true });

const testDockerConnection = async () => {
  try {
    await process.graderDocker.listImages({});
    return true;
  }
  catch (err) {
    return false;
  }
};


module.exports = {
  addStudent,
  addExam,
  createExam,
  createTempDir,
  removeTempDir,
  addLocalFile,
  createSubmission,
  createExercises,
  checkSubmissionResultExists,
  createTempDataDir,
  removeTempDataDir,
  testDockerConnection
};