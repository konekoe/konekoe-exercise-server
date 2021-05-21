const { generalLogger } = require("konekoe-server-log");
const { ExerciseVariant, StudentExerciseResult, ExerciseSubmission } = process.exerciseDb.models;
const { readFile } = require("fs").promises;
const { join } = require("path");
const { GRADER_PATH } = require("../utils/Config.js");
const { findVariant, parseSubmissionFiles } = require("./connection.js");
const { clientFilesToServerFiles } = require("./connection.js");
const InternalError = require("../utils/errors/InternalError.js");

const getVariantPath = async (variantId) => {
  try {
    generalLogger.serverInfo("Fetching variant path");

    const variantDoc = await ExerciseVariant.findById(variantId);

    return variantDoc.path;
  }
  catch (err) {
    return Promise.reject(new InternalError(err.message, err.stack));
  }
};

const saveSubmission = (files, points, output) => new ExerciseSubmission({
  points,
  submission: JSON.stringify(files),
  output
}).save();

// Either results or error != null but not both
const saveGraderResults = async (student, exam, exerciseSet, variantId, files, resultsObj, errorObj) => {
  try {
    // This document contains information on what exercises a student has attempted in an exam.
    // Submission ids are stored in this document.
    // NOTE: exerciseSet === ExamExerciseConfig => It contains references to the exercises relevant to this exam.
    const exerciseResult = await StudentExerciseResult.findOne({ student, exam, exerciseSet });

    // Find submissions for the target variant.
    let variantSubmissionMap = exerciseResult.submissions.find( ({ variant }) => variant.toString() === variantId.toString() );

    // No submissions for this variant have been made yet.
    if (!variantSubmissionMap) {
      generalLogger.debug("Variant submissions not found.");
      exerciseResult.submissions.push({ variant: variantId, submissions: [] });
      variantSubmissionMap = exerciseResult.submissions.find( ({ variant }) => variant === variantId );
    }

    let submissionDoc;

    // Note: If both are null an internal error will occur which is expected behavior.
    if (resultsObj) {
      submissionDoc = await saveSubmission(files, resultsObj.points, resultsObj.output);
    }
    else {
      submissionDoc = await saveSubmission(files, 0, errorObj.reason || errorObj.message);
    }

    variantSubmissionMap.submissions.push(submissionDoc);

    // Make sure that the submissions array is saved when the exercise result object is saved.
    exerciseResult.markModified("submissions");

    await exerciseResult.save();

    return;
  }
  catch (err) {
    return Promise.reject(new InternalError(err.message, err.stack));
  }
};

const parseVariantFiles = async (files) => Promise.all(files.map(async fileId => {
  try {
    const fileDoc = await File.findById(fileId);

    return { filename: fileDoc.filename, data: fileDoc.data.toString("utf-8") };
  }
  catch (err) {
    return Promise.reject(new InternalError(err.message, err.stack));
  }
}));

const parseVariantPaths = async (paths, variantRootPath) => Promise.all(paths.map(async path => {
  try {
    // Read file content from disk and return it as a string.
    const data = await readFile(join(GRADER_PATH, variantRootPath, path), "utf-8");

    // Parse filename from /path/to/file/filename
    return { filename: path.split("/").pop(), data };
  }
  catch (err) {
    return Promise.reject(new InternalError(err.message, err.stack));
  }
}));

// Parse File objects containing a filename and data buffer to { name, value } objects.
// Read file paths from disk and parse the filename and read buffer to a { name, value } object.
// TODO: Move noDelte options to database.
const variantFilesToJSON = async (variantDoc) => {
  try {
    return [...await parseVariantFiles(variantDoc.files), ...await parseVariantPaths(variantDoc.paths, variantDoc.path)];
  }
  catch (err) {
    return Promise.reject(new InternalError(err.message, err.stack));
  }
};

const findExerciseSubmission = async (submissionId) => ExerciseSubmission.findById(submissionId);

module.exports = {
  getVariantPath,
  saveGraderResults,
  findVariant,
  variantFilesToJSON,
  parseSubmissionFiles,
  findExerciseSubmission,
  clientFilesToServerFiles
};