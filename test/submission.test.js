const { generalLogger } = require("konekoe-server-log");
const { makeId } = require("konekoe-server-utils");
const { MongoConnection, clearData, closeConnections, examModels, exerciseModels } = require("konekoe-database");
const { 
  GRADER_RESULT_DIR, GRADER_ERROR_DIR,
  DOCKER_HOST, DOCKER_CA_CERT, 
  DOCKER_CLIENT_CERT, DOCKER_CLIENT_KEY 
} = require("../src/utils/Config.js");
const { join } = require("path");
const Docker = require("dockerode");

const GRADER_TEST_RUNNER = "test_runner.sh";

// Registered later
let services = {};
let testServices = {};

// Create mapping from ephemeral client ids to variant database ids and maxPoints
const createVariantMap = (exResult) => exResult.reduce((acc, { variant, exercise }) => {
  acc[makeId(10)] = { id: variant, maxPoints: exercise.points };
  return acc;
}, {});

const studentId = "Teppo_Testaaja";
const falseVariant = "some variant";
let testExerciseResult = {};
let testExam = {};

// Dummy for the MessageHandler class
const messageHandler = {
  logger: generalLogger,
  studentId,
  send: () => {} // Dummy for sending output data.
};

process.graderDocker = new Docker({
  protocol: "https",
  host: DOCKER_HOST,
  port: 2375,
  ca: DOCKER_CA_CERT,
  cert: DOCKER_CLIENT_CERT,
  key: DOCKER_CLIENT_KEY,
  version: "v1.40" // required when Docker >= v1.13, https://docs.docker.com/engine/api/version-history/
});

beforeAll(async () => {
  try {
    process.examDb = await MongoConnection("DUMMY");
    generalLogger.serverInfo("Connected to exam database");
    examModels(process.examDb);
    
    process.exerciseDb = await MongoConnection("DUMMY");
    generalLogger.serverInfo("Connected to exercise database");
    exerciseModels(process.exerciseDb);

    testServices = require("./services.js");


    services = require("../src/services/connection.js");

    // Bind handler function to message handler object.
    messageHandler.code_submission = require("../src/handlers/messages.js").code_submission.bind(messageHandler);

    generalLogger.serverInfo("Create temp directory for file path testing.");
    await testServices.createTempDir();

    const studentDoc = await testServices.addStudent(studentId);

    messageHandler.studentDbId = studentDoc._id;

    // Add exam with 1 exercise and 4 variants.
    const exerciseConfig = await testServices.createExercises(1, 4);

    testExam = await testServices.createExam(exerciseConfig);
    
    messageHandler.examDbId = testExam._id;
    messageHandler.exerciseConfigDbId = testExam.exerciseConfig._id;
    messageHandler.examCode = testExam.examCode;
    
    // Create an exercise result and add some submissions
    testExerciseResult = await services.createExerciseResult(studentDoc._id, testExam);

    const examExercises = await Promise.all(testExerciseResult.exercises.map(async ({ exercise, variant }) => ({ variant, exercise: await services.findExercise(exercise) })));
    
    messageHandler.variantMap = createVariantMap(examExercises);

    await testServices.createTempDataDir(studentId, testExam.examCode);
  }
  catch (err) {
    return Promise.reject(err);
  }
});

afterAll(async () => {
  await clearData([process.examDb, process.exerciseDb]);
  await closeConnections([process.examDb, process.exerciseDb]);
  generalLogger.serverInfo("Closed database connections");
  await testServices.removeTempDir();
  
  // Might fail if some copied files can't be removed.
  // Please check how the file permissions of target files are configured.
  try {
    await testServices.removeTempDataDir(studentId, testExam.examCode);
  }
  catch (_err) {}
});

test("Can connect to docker API", async () => {
  expect(testServices.testDockerConnection())
  .resolves
  .toBeTruthy();
});


// Implicitly check that errors have correct form.
describe("An error", () => {

  it("should be returned when the received variant id is not valid (MessageError)", async () => {
    return expect(messageHandler.code_submission({
      exerciseId: falseVariant,
      files: []
    }))
    .resolves
    .toEqual(
      expect
      .objectContaining({
        "exerciseId": falseVariant,
        "error": expect.objectContaining({
          name: "MessageError"
        })
      })
      );
  });

  it("should be returned internal configuration causes the handler to throw an error (InternalError)", async () => {
    const validId = Object.keys(messageHandler.variantMap)[0];

    // Set student id to null to produce an internal error.
    const tempMessageHandler = {
      ...messageHandler
    };
    tempMessageHandler.studentId = null;
    tempMessageHandler.code_submission = require("../src/handlers/messages.js").code_submission.bind(tempMessageHandler);

    return expect(tempMessageHandler.code_submission({
      exerciseId: validId,
      files: []
    }))
    .resolves
    .toEqual(
      expect
      .objectContaining({
        "exerciseId": validId,
        "error": expect.objectContaining({
          name: "InternalError"
        })
      })
      );
  });
});

//NOTE: These tests target a c-grader.
// The tests assume that the required data volumes have already been configured.
describe("Results should be", () => {
  let validId = "";

  beforeAll(() => {
    validId = Object.keys(messageHandler.variantMap)[0];
  });

  describe("saved when the grader produces an error", () => {
    it("due to an runtime error", async () => {
      const resultStr = "{\"error_type\":\"RETTYPE\",\"error_message\":\"Error in executed code.\"}";

      await expect(messageHandler.code_submission({
        exerciseId: validId,
        files: [{
          filename: GRADER_TEST_RUNNER,
          data: `
          #!/bin/bash

          echo '${ resultStr }' > ${ join(GRADER_ERROR_DIR, "error.json")  }

          exit 0
          `
        }]
      }))
      .resolves
      .toEqual(
        expect
        .objectContaining({
          "exerciseId": validId,
          "error": expect.objectContaining({
            name: "GraderError"
          })
        })
        );

      return expect(testServices.checkSubmissionResultExists(testExerciseResult, messageHandler.variantMap[validId].id))
        .resolves
        .toEqual(
          expect
          .objectContaining({
            points: 0,
            submission: expect.stringContaining("RETTYPE"),
            date: expect.any(Date)
          })
        );
    });

    it("due to an internal timeout", async () => {
      const resultStr = "\'{\"error_type\":\"TIMEOUT\",\"error_message\":\"Error in executed code.\"}\'"

      await expect(messageHandler.code_submission({
        exerciseId: validId,
        files: [{
          filename: GRADER_TEST_RUNNER,
          data:`
          #!/bin/bash

          echo ${ resultStr } > ${ join(GRADER_ERROR_DIR, "error.json")  }

          exit 0
          `
        }]
      }))
      .resolves
      .toEqual(
        expect
        .objectContaining({
          "exerciseId": validId,
          "error": expect.objectContaining({
            name: "TimeoutError"
          })
        })
        );

      return expect(testServices.checkSubmissionResultExists(testExerciseResult, messageHandler.variantMap[validId].id))
        .resolves
        .toEqual(
          expect
          .objectContaining({
            points: 0,
            submission: expect.stringContaining("TIMEOUT"),
            date: expect.any(Date)
          })
        );
    });
  });

  it("when the grader timeouts and produces an TimeoutError", async () => {
    await expect(messageHandler.code_submission({
      exerciseId: validId,
      files: [{
        filename: GRADER_TEST_RUNNER,
        data: `
        #!/bin/bash

        rm error.json

        sleep 2m

        exit 0
        `
      }]
    }))
    .resolves
    .toEqual(
      expect
      .objectContaining({
        "exerciseId": validId,
        "error": expect.objectContaining({
          name: "TimeoutError"
        })
      })
      );

    return expect(testServices.checkSubmissionResultExists(testExerciseResult, messageHandler.variantMap[validId].id))
      .resolves
      .toEqual(
        expect
        .objectContaining({
          points: 0,
          submission: expect.stringContaining("sleep 2m"),
          date: expect.any(Date)
        })
      );
  }, 120000);

  it("saved and returned when the process was succesful", async () => {
    const resultStr = "{\"points\":\"10\",\"output\":\"Good job!\"}";

    await expect(messageHandler.code_submission({
      exerciseId: validId,
      files: [{
        filename: GRADER_TEST_RUNNER,
        data: `
        #!/bin/bash

        rm ./error.json

        echo '${ resultStr }' > ${ join(GRADER_RESULT_DIR, "result.json")  }

        exit 0
        `
      }]
    }))
    .resolves
    .toEqual(
      expect
      .objectContaining({
        "exerciseId": validId,
        "points": "10",
        "output": "Good job!"
      })
      );

    return expect(testServices.checkSubmissionResultExists(testExerciseResult, messageHandler.variantMap[validId].id))
      .resolves
      .toEqual(
        expect
        .objectContaining({
          points: 10,
          submission: expect.stringContaining("result.json"),
          output: "Good job!",
          date: expect.any(Date)
        })
      );
  }, 60000);
});