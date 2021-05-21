const { Student, Exam, File } = process.examDb.models;
const { StudentExerciseResult, Exercise, ExerciseVariant, ExamExerciseConfig, ExerciseSubmission } = process.exerciseDb.models;
const { getRandomInt } = require("konekoe-server-utils");
const InternalError = require("../utils/errors/InternalError.js");

const findStudent = async (studentId) => Student.findOne({ studentId }); 

const findExam = async (examCode) => {
  try {
    const exam = await Exam.findOne({ examCode });

    if (!exam)
      return Promise.reject(new InternalError("Invalid exam."));

    exam.exerciseConfig = await ExamExerciseConfig.findById(exam.exerciseConfig);
    
    return exam;
  }
  catch (err) {
    return Promise.reject(new InternalError(err.message, err.stack));
  }
};

const findExerciseResult = async (student, exam) => StudentExerciseResult.findOne({ student, exam, exerciseSet: exam.exerciseConfig });

const findExercise = async (id) => Exercise.findById(id);

const findVariant = async (variantId) => ExerciseVariant.findById(variantId);

const exerciseVariantMap = async (exerciseId) => {
  try {
    const exercise = await Exercise.findById(exerciseId);
    const variant = exercise.variants[getRandomInt(0, exercise.variants.length)];

    return {
      exercise,
      variant
    };
  }
  catch (err) {
    return Promise.reject(new InternalError(err.message, err.stack));
  }
};

// Creates a StudentExerciseResult which maps student, exam and exercise config
// to exercise variants and submissions.
// If an exercise has multiple variants, one is chosen randomly.
const createExerciseResult = async (studentId, examDoc) => {
  try {
    const exercises = await Promise.all(examDoc.exerciseConfig.exercises.map(exerciseVariantMap));

    const result = new StudentExerciseResult({ student: studentId, exam: examDoc._id, exerciseSet: examDoc.exerciseConfig, exercises });

    await result.save();
    
    return result;
  }
  catch (err) {
    return Promise.reject(new InternalError(err.message, err.stack));
  }
};

const clientFilesToServerFiles = (fileArr) => {
  return fileArr.reduce((acc, fileObj) => {
    acc[fileObj.filename] = fileObj.data;
    return acc;
  },{});
};

const serverFilesToClientFiles = (filesObj) => {
  // Some old test submissions were saved in client format.
  if (filesObj instanceof Array)
    return filesObj;

  return Object.entries(filesObj).map(([filename, data]) => ({ filename, data }));
};

const parseSubmissionFiles = (filesStr) => {
  return serverFilesToClientFiles(JSON.parse(filesStr));
}


const findVariantSubmissionList = async (variant, submissionsArr) => {
  try {
    let variantSubmissionList = submissionsArr.find(sub => sub.variant.toString() === variant.toString());

    // No submissions for this variant.
    if (!variantSubmissionList)
      return null;

    // Populate submissions.
    return await Promise.all(variantSubmissionList.submissions.map(sub => ExerciseSubmission.findById(sub)));
  }
  catch (err) {
    return Promise.reject(new InternalError(err.message, err.stack));
  }
};

const findLatestVariantSubmissionFiles = async (variantSubmissionList) => {
  try {

    if (!variantSubmissionList)
      return null;
    
    // Find newest.
    const newestDate = new Date(Math.max.apply(null, variantSubmissionList.map(sub => sub.date))).getTime();
    const newestSub = variantSubmissionList.find(sub => sub.date.getTime() === newestDate);

    return { files: parseSubmissionFiles(newestSub.submission), id: newestSub._id.toString() };
  }
  catch (err) {
    return Promise.reject(new InternalError(err.message, err.stack));
  }
};

module.exports = {
  findStudent,
  findExam,
  findExerciseResult,
  findVariant,
  createExerciseResult,
  findVariantSubmissionList,
  findLatestVariantSubmissionFiles,
  findExercise,
  parseSubmissionFiles,
  clientFilesToServerFiles,
  serverFilesToClientFiles
};